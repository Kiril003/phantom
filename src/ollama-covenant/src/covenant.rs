//! The Memory Covenant — the rules, in pure form.
//!
//! Local inference is a guest in the board's RAM, not a resident. Two clauses,
//! enforced on every load-inducing request regardless of what the caller asked
//! for:
//!
//!   1. **Auto-unload.** `keep_alive: 0` — Ollama drops the model from memory
//!      the moment generation ends. Its default is 5 minutes of squatting.
//!   2. **Context ceiling.** `options.num_ctx` is clamped. The KV cache grows
//!      linearly with the context window, so an unbounded `num_ctx` (the backend
//!      asks for 32768) is the single biggest way local inference balloons.
//!
//! Kept DOM-free of any I/O so the clauses are unit-testable on their own.

use serde_json::{json, Map, Value};

#[derive(Clone, Debug)]
pub struct Covenant {
    /// Seconds Ollama may hold the model after generation. 0 = unload at once.
    pub keep_alive_s: u64,
    /// Hard ceiling on the context window handed to a local model.
    pub num_ctx_ceiling: u64,
    /// Optional cap on generated tokens; 0 disables the clause.
    pub num_predict_ceiling: u64,
}

impl Default for Covenant {
    fn default() -> Self {
        Self {
            keep_alive_s: 0,
            num_ctx_ceiling: 4096,
            num_predict_ceiling: 0,
        }
    }
}

/// Requests that make Ollama pull a model into RAM. Everything else (tags, ps,
/// show, version) is a passthrough and must not be rewritten.
pub fn is_load_inducing(path: &str) -> bool {
    matches!(
        path,
        "/api/chat"
            | "/api/generate"
            | "/api/embed"
            | "/api/embeddings"
            | "/v1/chat/completions"
            | "/v1/completions"
            | "/v1/embeddings"
    )
}

/// Impose the covenant on a request body. Returns true if anything was changed.
/// A body we cannot parse as a JSON object is passed through untouched — the
/// proxy must never corrupt a request it does not understand.
pub fn impose(body: &mut Value, c: &Covenant) -> bool {
    let Some(obj) = body.as_object_mut() else {
        return false;
    };

    let mut changed = false;

    // Clause 1 — the model does not linger.
    if obj.get("keep_alive") != Some(&json!(c.keep_alive_s)) {
        obj.insert("keep_alive".into(), json!(c.keep_alive_s));
        changed = true;
    }

    // Clause 2 — the context window has a ceiling.
    let opts = obj
        .entry("options")
        .or_insert_with(|| Value::Object(Map::new()));
    if !opts.is_object() {
        *opts = Value::Object(Map::new());
        changed = true;
    }
    if let Some(o) = opts.as_object_mut() {
        let asked = o.get("num_ctx").and_then(Value::as_u64);
        let capped = asked.unwrap_or(c.num_ctx_ceiling).min(c.num_ctx_ceiling);
        if asked != Some(capped) {
            o.insert("num_ctx".into(), json!(capped));
            changed = true;
        }
        if c.num_predict_ceiling > 0 {
            let asked_p = o.get("num_predict").and_then(Value::as_u64);
            let capped_p = asked_p
                .unwrap_or(c.num_predict_ceiling)
                .min(c.num_predict_ceiling);
            if asked_p != Some(capped_p) {
                o.insert("num_predict".into(), json!(capped_p));
                changed = true;
            }
        }
    }

    changed
}

/// Model names Ollama currently holds in RAM, read from `/api/ps`.
pub fn resident_models(ps: &Value) -> Vec<String> {
    ps.get("models")
        .and_then(Value::as_array)
        .map(|ms| {
            ms.iter()
                .filter_map(|m| {
                    m.get("model")
                        .or_else(|| m.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The body that evicts a model from RAM: a zero-token request with keep_alive 0.
pub fn eviction_body(model: &str) -> Value {
    json!({ "model": model, "keep_alive": 0, "prompt": "" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c() -> Covenant {
        Covenant {
            keep_alive_s: 0,
            num_ctx_ceiling: 4096,
            num_predict_ceiling: 0,
        }
    }

    #[test]
    fn forces_immediate_unload_even_when_caller_asks_to_linger() {
        let mut b = json!({ "model": "llama3.2:3b", "keep_alive": "30m" });
        assert!(impose(&mut b, &c()));
        assert_eq!(b["keep_alive"], json!(0));
    }

    #[test]
    fn caps_the_context_window_the_backend_asks_for() {
        // The backend's configured 32768 is exactly the ballooning case.
        let mut b = json!({ "model": "m", "options": { "num_ctx": 32768 } });
        assert!(impose(&mut b, &c()));
        assert_eq!(b["options"]["num_ctx"], json!(4096));
    }

    #[test]
    fn imposes_a_ceiling_when_none_was_requested() {
        let mut b = json!({ "model": "m" });
        assert!(impose(&mut b, &c()));
        assert_eq!(b["options"]["num_ctx"], json!(4096));
        assert_eq!(b["keep_alive"], json!(0));
    }

    #[test]
    fn leaves_a_thriftier_request_alone() {
        let mut b = json!({ "model": "m", "keep_alive": 0, "options": { "num_ctx": 1024 } });
        assert!(!impose(&mut b, &c()));
        assert_eq!(b["options"]["num_ctx"], json!(1024));
    }

    #[test]
    fn replaces_a_malformed_options_field_rather_than_trusting_it() {
        let mut b = json!({ "model": "m", "options": "nonsense" });
        assert!(impose(&mut b, &c()));
        assert_eq!(b["options"]["num_ctx"], json!(4096));
    }

    #[test]
    fn caps_num_predict_only_when_the_clause_is_armed() {
        let mut armed = c();
        armed.num_predict_ceiling = 256;
        let mut b = json!({ "model": "m", "options": { "num_predict": 4096 } });
        impose(&mut b, &armed);
        assert_eq!(b["options"]["num_predict"], json!(256));

        let mut b2 = json!({ "model": "m", "options": { "num_predict": 4096 } });
        impose(&mut b2, &c()); // disarmed
        assert_eq!(b2["options"]["num_predict"], json!(4096));
    }

    #[test]
    fn a_non_object_body_is_never_corrupted() {
        let mut b = json!([1, 2, 3]);
        assert!(!impose(&mut b, &c()));
        assert_eq!(b, json!([1, 2, 3]));
    }

    #[test]
    fn only_load_inducing_paths_are_rewritten() {
        assert!(is_load_inducing("/api/chat"));
        assert!(is_load_inducing("/api/generate"));
        assert!(is_load_inducing("/api/embeddings"));
        assert!(is_load_inducing("/v1/chat/completions"));
        // Read-only endpoints must pass through untouched.
        assert!(!is_load_inducing("/api/tags"));
        assert!(!is_load_inducing("/api/ps"));
        assert!(!is_load_inducing("/api/version"));
    }

    #[test]
    fn reads_resident_models_from_ps() {
        let ps = json!({ "models": [ { "model": "llama3.2:3b" }, { "name": "phi3:mini" } ] });
        assert_eq!(resident_models(&ps), vec!["llama3.2:3b", "phi3:mini"]);
        assert!(resident_models(&json!({ "models": [] })).is_empty());
        assert!(resident_models(&json!({})).is_empty());
    }
}
