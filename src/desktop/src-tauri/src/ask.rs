//! The Breath Line's answer-in-place bridge (AEGIS §4.2).
//!
//! A submitted line must return as an answer *beneath the line* in a breath —
//! no chat window, no Facet, no ceremony. This module owns the thin HTTP path
//! to the PHANTOM backend: a lazy loopback PIN login (the backend permits the
//! bootstrap PIN only from loopback — exactly where the membrane runs), a
//! cached JWT plus a threaded session id so follow-ups share context, and one
//! POST per ask. Kept in Rust, never the webview, so the Breath Line's payload
//! stays impossibly light and the token never touches transparent glass.

use std::sync::Mutex;

use serde::Deserialize;

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

    /// Submit one line, return the entity's reply text. Threads the session so
    /// consecutive asks in a single summon share memory; re-logs in once on a
    /// stale token so a long-lived membrane never dead-ends on expiry.
    pub async fn ask(&self, text: &str) -> Result<String, String> {
        let token = match self.cached_token() {
            Some(t) => t,
            None => self.login().await?,
        };
        let mut resp = self.post_message(&token, text).await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            let fresh = self.login().await?;
            resp = self.post_message(&fresh, text).await?;
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
