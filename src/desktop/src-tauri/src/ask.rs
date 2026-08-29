//! The Breath Line's answer-in-place bridge (AEGIS §4.2).
//!
//! A submitted line must return as an answer *beneath the line* in a breath —
//! no chat window, no Facet, no ceremony. This module owns the thin path to the
//! PHANTOM backend: a lazy loopback PIN login (the backend permits the bootstrap
//! PIN only from loopback — exactly where the membrane runs), a cached JWT plus
//! a threaded session id so follow-ups share context, and one POST per ask.
//!
//! Day-N — live streaming: the POST that triggers a reply is the same call the
//! backend streams token deltas under, broadcast on its user-scoped `chat`
//! channel (`send_message` → `_send_delta`, routes_chat.py). For the duration of
//! each ask we open a Rust-side WebSocket to `/ws?token=…`, read the `chat/stream`
//! frames, and hand each delta to the breath webview via `window.__breathDelta`
//! so the answer types itself in beneath the line at the model's own pace. The
//! POST's final body stays authoritative — it replaces the streamed text once
//! the turn completes, so a dropped socket degrades to exactly the old
//! answer-at-once behaviour, never a truncated reply.
//!
//! The JWT is opened into the socket URL *in Rust and only in Rust* — it is
//! never handed to the webview, so the token still never touches transparent
//! glass. The glass receives rendered deltas, nothing privileged.

use std::sync::Mutex;

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::WebviewWindow;
use tokio_tungstenite::tungstenite::client::ClientRequestBuilder;
use tokio_tungstenite::tungstenite::http::Uri;
use tokio_tungstenite::tungstenite::Message;

/// Маркер під-протоколу автентифікації. Дзеркалить `BEARER_SUBPROTOCOL`
/// у `src/backend/security/ws_auth.py` і `src/frontend/src/services/wsAuth.ts`.
const BEARER_SUBPROTOCOL: &str = "phantom.bearer.v1";

pub struct AskState {
    client: reqwest::Client,
    api_base: String,
    user: String,
    pin: String,
    session: Mutex<Session>,
}

#[derive(Default)]
struct Session {
    token: Option<String>,
    session_id: Option<String>,
}

#[derive(Deserialize)]
struct LoginResponse {
    token: String,
}

#[derive(Deserialize)]
struct MessageBody {
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: MessageBody,
    session_id: Option<String>,
}

/// One hub envelope (`{channel,type,data,ts}`), narrowed to the fields the
/// Breath Line acts on. Non-`chat/stream` frames (sensor, state, `_meta`, …)
/// still deserialize — serde ignores the unknown `data` fields and the
/// defaults leave `delta`/`done` inert — and are dropped by the channel guard.
#[derive(Deserialize)]
struct HubEnvelope {
    channel: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    data: StreamData,
}

#[derive(Deserialize, Default)]
struct StreamData {
    #[serde(default)]
    delta: String,
    #[serde(default)]
    done: bool,
}

impl AskState {
    /// All wiring is env-overridable (§ settings-from-UI covenant); defaults
    /// target the co-located backend with the bootstrap identity.
    ///
    /// PIN resolution (the backend no longer ships a known default PIN —
    /// it mints a random one-time bootstrap PIN on first boot and writes it
    /// to `<data-dir>/identity/bootstrap_pin`):
    ///   1. `PHANTOM_PIN` env — the operator's actual PIN once rotated.
    ///   2. `PHANTOM_PIN_FILE` env — path to the bootstrap-PIN marker the
    ///      backend wrote (co-located install; the launcher points this at
    ///      `$PHANTOM_DATA_DIR/identity/bootstrap_pin`).
    ///   3. empty — login will fail with a clear "no PIN configured" error
    ///      rather than silently trying a dead default.
    pub fn from_env() -> Self {
        let api_base =
            std::env::var("PHANTOM_API").unwrap_or_else(|_| "http://127.0.0.1:8000".into());
        let user = std::env::var("PHANTOM_USER").unwrap_or_else(|_| "phantom".into());
        let pin = Self::resolve_pin();
        Self {
            client: reqwest::Client::new(),
            api_base,
            user,
            pin,
            session: Mutex::new(Session::default()),
        }
    }

    fn resolve_pin() -> String {
        if let Ok(p) = std::env::var("PHANTOM_PIN") {
            if !p.is_empty() {
                return p;
            }
        }
        if let Ok(path) = std::env::var("PHANTOM_PIN_FILE") {
            if let Ok(contents) = std::fs::read_to_string(&path) {
                let trimmed = contents.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
        String::new()
    }

    async fn login(&self) -> Result<String, String> {
        if self.pin.is_empty() {
            return Err(
                "no PIN configured — set PHANTOM_PIN or PHANTOM_PIN_FILE (the \
                 backend prints a one-time bootstrap PIN at first boot)"
                    .into(),
            );
        }
        let url = format!("{}/api/v1/auth/login/pin", self.api_base);
        let resp = self
            .client
            .post(&url)
            .json(&serde_json::json!({ "username": self.user, "pin": self.pin }))
            .send()
            .await
            .map_err(|e| format!("login unreachable: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("login refused ({})", resp.status()));
        }
        let body: LoginResponse = resp
            .json()
            .await
            .map_err(|e| format!("login parse: {e}"))?;
        self.session.lock().unwrap().token = Some(body.token.clone());
        Ok(body.token)
    }

    fn cached_token(&self) -> Option<String> {
        self.session.lock().unwrap().token.clone()
    }

    fn session_id(&self) -> Option<String> {
        self.session.lock().unwrap().session_id.clone()
    }

    async fn post_message(&self, token: &str, text: &str) -> Result<reqwest::Response, String> {
        let url = format!("{}/api/v1/chat/message", self.api_base);
        let mut body = serde_json::json!({ "content": text, "input_method": "text" });
        if let Some(sid) = self.session_id() {
            body["session_id"] = serde_json::Value::String(sid);
        }
        self.client
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("ask unreachable: {e}"))
    }

    /// Map the HTTP api base onto its WebSocket origin. The auth token is
    /// deliberately NOT appended here: round-4 panel P4 counted full JWTs in
    /// the node's access log, because uvicorn writes the request path
    /// verbatim. The token rides the `phantom.bearer.v1` subprotocol instead
    /// (see `security/ws_auth.py`), which handshake headers keep out of logs.
    fn ws_url(&self) -> String {
        let origin = self
            .api_base
            .trim_end_matches('/')
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        format!("{origin}/ws")
    }

    /// Open a per-ask WebSocket to the hub and pump this user's `chat/stream`
    /// deltas into the breath webview until the turn's `done` frame arrives (or
    /// the caller aborts the task once the POST resolves). Best-effort: any
    /// failure — unreachable socket, stream disabled server-side, a tool/widget
    /// answer that never streams — simply yields no live deltas, and the POST's
    /// final body carries the whole reply exactly as before.
    fn spawn_delta_stream(
        &self,
        window: WebviewWindow,
        token: String,
    ) -> tauri::async_runtime::JoinHandle<()> {
        let url = self.ws_url();
        tauri::async_runtime::spawn(async move {
            // Маркер і одразу за ним токен — рівно те, що читає бекенд у
            // `extract_ws_token`. Вузол мусить підтвердити маркер у відповіді.
            let Ok(uri) = url.parse::<Uri>() else {
                return;
            };
            let request = ClientRequestBuilder::new(uri)
                .with_sub_protocol(BEARER_SUBPROTOCOL)
                .with_sub_protocol(token);
            let Ok((mut ws, _resp)) = tokio_tungstenite::connect_async(request).await else {
                return;
            };
            // Default subscription is every channel, so `chat` arrives without
            // sending a `subscribe` control frame.
            while let Some(Ok(msg)) = ws.next().await {
                let Message::Text(txt) = msg else { continue };
                let Ok(env) = serde_json::from_str::<HubEnvelope>(txt.as_str()) else {
                    continue;
                };
                if env.channel != "chat" || env.kind != "stream" {
                    continue;
                }
                if !env.data.delta.is_empty() {
                    let payload = serde_json::json!({ "delta": env.data.delta });
                    let _ = window
                        .eval(format!("window.__breathDelta&&window.__breathDelta({payload})"));
                }
                if env.data.done {
                    break;
                }
            }
        })
    }

    /// Stream `text`'s deltas into the breath webview for the life of one POST.
    /// The listener is torn down the instant the POST resolves so it never
    /// outlives the ask, sidestepping all reconnect / token-refresh lifecycle.
    async fn stream_and_post(
        &self,
        window: &WebviewWindow,
        token: &str,
        text: &str,
    ) -> Result<reqwest::Response, String> {
        let listener = self.spawn_delta_stream(window.clone(), token.to_string());
        let resp = self.post_message(token, text).await;
        listener.abort();
        resp
    }

    /// Submit one line, return the entity's reply text. Threads the session so
    /// consecutive asks in a single summon share memory; re-logs in once on a
    /// stale token so a long-lived membrane never dead-ends on expiry. Streams
    /// deltas into `window` as the reply generates (see `spawn_delta_stream`).
    pub async fn ask(&self, window: &WebviewWindow, text: &str) -> Result<String, String> {
        let token = match self.cached_token() {
            Some(t) => t,
            None => self.login().await?,
        };
        let mut resp = self.stream_and_post(window, &token, text).await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            let fresh = self.login().await?;
            resp = self.stream_and_post(window, &fresh, text).await?;
        }
        if !resp.status().is_success() {
            return Err(format!("ask failed ({})", resp.status()));
        }
        let body: ChatResponse = resp.json().await.map_err(|e| format!("ask parse: {e}"))?;
        if let Some(sid) = body.session_id {
            self.session.lock().unwrap().session_id = Some(sid);
        }
        Ok(body.message.content)
    }
}
