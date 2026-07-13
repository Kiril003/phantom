//! ollama-covenant — a lightweight guard in front of local inference.
//!
//! The board has 11 GB and an isometric ATLAS floor still to render. Ollama's
//! defaults (model resident 5 minutes after every call, unbounded context) make
//! local inference a squatter. This proxy stands between the backend and Ollama
//! and enforces the Memory Covenant on every request that could pull weights
//! into RAM — no matter what the caller asked for:
//!
//!   * `keep_alive: 0`      — the model is evicted the instant generation ends.
//!   * `options.num_ctx`    — clamped to a ceiling, so the KV cache cannot balloon.
//!   * a watchdog           — evicts any model found squatting, which also covers
//!                            callers that bypass the proxy entirely.
//!
//! Everything else is a transparent, streaming passthrough: token streams are
//! piped through frame by frame and never buffered, so time-to-first-token is
//! unchanged.
//!
//! Config (env): COVENANT_BIND, COVENANT_UPSTREAM, COVENANT_NUM_CTX,
//! COVENANT_KEEP_ALIVE_S, COVENANT_IDLE_GRACE_MS, COVENANT_SWEEP_MS.

mod covenant;

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::TryStreamExt;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{HeaderName, CONTENT_LENGTH, HOST, TRANSFER_ENCODING};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use tokio::net::TcpListener;

use covenant::{eviction_body, impose, is_load_inducing, resident_models, Covenant};

type Body = BoxBody<Bytes, std::io::Error>;

struct Ctx {
    client: reqwest::Client,
    upstream: String,
    rules: Covenant,
    idle_grace: Duration,
    /// Requests currently in flight — a model must never be evicted mid-answer.
    inflight: AtomicU64,
    /// Monotonic ms of the last completed request.
    last_activity: AtomicU64,
    imposed: AtomicU64,
    evicted: AtomicU64,
    started: std::time::Instant,
}

impl Ctx {
    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn full(body: impl Into<Bytes>) -> Body {
    Full::new(body.into())
        .map_err(|never| match never {})
        .boxed()
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let bind: SocketAddr = std::env::var("COVENANT_BIND")
        .unwrap_or_else(|_| "127.0.0.1:11435".into())
        .parse()?;
    let upstream = std::env::var("COVENANT_UPSTREAM")
        .unwrap_or_else(|_| "http://127.0.0.1:11434".into())
        .trim_end_matches('/')
        .to_string();

    let rules = Covenant {
        keep_alive_s: env_u64("COVENANT_KEEP_ALIVE_S", 0),
        num_ctx_ceiling: env_u64("COVENANT_NUM_CTX", 4096),
        num_predict_ceiling: env_u64("COVENANT_NUM_PREDICT", 0),
    };
    let sweep = Duration::from_millis(env_u64("COVENANT_SWEEP_MS", 5_000));
    let idle_grace = Duration::from_millis(env_u64("COVENANT_IDLE_GRACE_MS", 10_000));

    let ctx = Arc::new(Ctx {
        // No timeout: a cold local model can take minutes to answer on this board.
        client: reqwest::Client::builder().build()?,
        upstream: upstream.clone(),
        rules: rules.clone(),
        idle_grace,
        inflight: AtomicU64::new(0),
        last_activity: AtomicU64::new(0),
        imposed: AtomicU64::new(0),
        evicted: AtomicU64::new(0),
        started: std::time::Instant::now(),
    });

    eprintln!(
        "covenant: {bind} → {upstream} | keep_alive={}s num_ctx≤{} | sweep {}ms, grace {}ms",
        rules.keep_alive_s,
        rules.num_ctx_ceiling,
        sweep.as_millis(),
        idle_grace.as_millis(),
    );

    tokio::spawn(watchdog(ctx.clone(), sweep));

    let listener = TcpListener::bind(bind).await?;
    loop {
        let (stream, _) = listener.accept().await?;
        let ctx = ctx.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let svc = service_fn(move |req| handle(req, ctx.clone()));
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, svc)
                .await
            {
                eprintln!("covenant: connection error: {e}");
            }
        });
    }
}

/// Evict anything squatting in RAM. `keep_alive: 0` on every proxied request
/// already unloads on completion; this catches callers that bypass the proxy and
/// is the belt to that pair of braces. Never fires while a request is in flight.
async fn watchdog(ctx: Arc<Ctx>, sweep: Duration) {
    loop {
        tokio::time::sleep(sweep).await;

        if ctx.inflight.load(Ordering::Acquire) > 0 {
            continue;
        }
        let idle_for = ctx
            .now_ms()
            .saturating_sub(ctx.last_activity.load(Ordering::Acquire));
        if idle_for < ctx.idle_grace.as_millis() as u64 {
            continue;
        }

        let Ok(res) = ctx
            .client
            .get(format!("{}/api/ps", ctx.upstream))
            .send()
            .await
        else {
            continue;
        };
        let Ok(ps) = res.json::<Value>().await else {
            continue;
        };

        let squatters = resident_models(&ps);
        if squatters.is_empty() {
            continue;
        }

        for model in squatters {
            // Re-check: a request may have arrived while we were asking.
            if ctx.inflight.load(Ordering::Acquire) > 0 {
                break;
            }
            eprintln!("covenant: evicting squatter {model}");
            let _ = ctx
                .client
                .post(format!("{}/api/generate", ctx.upstream))
                .json(&eviction_body(&model))
                .send()
                .await;
            ctx.evicted.fetch_add(1, Ordering::Relaxed);
        }

        // Ollama takes a moment to actually release the weights, so /api/ps can
        // still name the model on the next sweep. Restart the grace clock after
        // an eviction pass rather than hammering it with duplicate unloads.
        ctx.last_activity.store(ctx.now_ms(), Ordering::Release);
    }
}

async fn handle(req: Request<Incoming>, ctx: Arc<Ctx>) -> Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_string();

    if path == "/covenant/status" {
        return Ok(status(&ctx).await);
    }

    ctx.inflight.fetch_add(1, Ordering::AcqRel);
    let out = proxy(req, &ctx, &path).await;
    ctx.last_activity.store(ctx.now_ms(), Ordering::Release);
    ctx.inflight.fetch_sub(1, Ordering::AcqRel);

    Ok(out.unwrap_or_else(|e| {
        let msg = json!({ "error": format!("covenant: upstream unreachable: {e}") });
        Response::builder()
            .status(StatusCode::BAD_GATEWAY)
            .header("content-type", "application/json")
            .body(full(msg.to_string()))
            .expect("static response builds")
    }))
}

async fn proxy(
    req: Request<Incoming>,
    ctx: &Arc<Ctx>,
    path: &str,
) -> Result<Response<Body>, Box<dyn std::error::Error + Send + Sync>> {
    let method = req.method().clone();
    let pq = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| path.to_owned());
    let headers = req.headers().clone();

    let mut body = req.into_body().collect().await?.to_bytes();

    // The covenant binds only the requests that can pull weights into RAM.
    if method == Method::POST && is_load_inducing(path) {
        if let Ok(mut v) = serde_json::from_slice::<Value>(&body) {
            if impose(&mut v, &ctx.rules) {
                ctx.imposed.fetch_add(1, Ordering::Relaxed);
                body = Bytes::from(serde_json::to_vec(&v)?);
            }
        }
        // Unparseable bodies fall through untouched rather than be corrupted.
    }

    let url = format!("{}{}", ctx.upstream, pq);
    let mut rb = ctx.client.request(method, url);
    for (k, v) in headers.iter() {
        // Hop-by-hop and length headers are ours to recompute, not to copy.
        if k == HOST || k == CONTENT_LENGTH || k == TRANSFER_ENCODING {
            continue;
        }
        rb = rb.header(k.clone(), v.clone());
    }
    let upstream_res = rb.body(body).send().await?;

    let mut out = Response::builder().status(upstream_res.status());
    for (k, v) in upstream_res.headers().iter() {
        if k == CONTENT_LENGTH || k == TRANSFER_ENCODING {
            continue;
        }
        out = out.header(HeaderName::from(k), v.clone());
    }

    // Stream the token frames straight through — never buffer a generation.
    let stream = upstream_res
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));

    Ok(out.body(StreamBody::new(stream).boxed())?)
}

async fn status(ctx: &Arc<Ctx>) -> Response<Body> {
    let ps = async {
        let res = ctx
            .client
            .get(format!("{}/api/ps", ctx.upstream))
            .send()
            .await
            .ok()?;
        res.json::<Value>().await.ok()
    }
    .await
    .unwrap_or_else(|| json!({}));

    let body = json!({
        "upstream": ctx.upstream,
        "keep_alive_s": ctx.rules.keep_alive_s,
        "num_ctx_ceiling": ctx.rules.num_ctx_ceiling,
        "idle_grace_ms": ctx.idle_grace.as_millis() as u64,
        "requests_bound": ctx.imposed.load(Ordering::Relaxed),
        "squatters_evicted": ctx.evicted.load(Ordering::Relaxed),
        "inflight": ctx.inflight.load(Ordering::Relaxed),
        "resident": resident_models(&ps),
    });

    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(full(body.to_string()))
        .expect("static response builds")
}
