#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod ask;
mod conduit;
mod overlay;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

use conduit::ConduitEvent;

/// Whether the Breath Line is currently summoned. The startup pre-warm maps the
/// window off-screen for ~1.2s, which pollutes `is_visible()` — so summon state
/// is tracked explicitly here and is the single source of truth for the tap
/// toggle, the Esc dismiss, and the pre-warm's own deferred hide.
static SUMMONED: AtomicBool = AtomicBool::new(false);

fn main() {
    // webkitgtk's dmabuf renderer blanks the webview on software-GL stacks
    // (Adreno/VNC on this board: "DRI3 error" → black window), and the
    // GL compositing path blanks a webview across hide→show on that same
    // stack. Both env vars used to be set unconditionally on Linux — which
    // meant every normal desktop GPU also had hardware webkit compositing
    // disabled for no reason. Now: respect an operator override if either
    // var is already set, otherwise only force the software-GL workaround
    // when software GL actually looks likely (opt-in flag, or no DRM render
    // node present — the honest "no GPU driver" signal).
    #[cfg(target_os = "linux")]
    {
        // Same per-var "operator wins" check as before — an explicitly set
        // value (either "1" or "0") is never overridden.
        let dmabuf_operator_set = std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some();
        let compositing_operator_set =
            std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some();

        if dmabuf_operator_set || compositing_operator_set {
            eprintln!("aegis: webkit render var(s) operator-set — leaving as configured");
        }

        // No render node under /dev/dri means no usable DRM/KMS GPU driver —
        // an honest signal this is a software-GL host (this board's
        // Radxa/Adreno-over-VNC path, historically). AEGIS_SOFTWARE_GL lets
        // an operator force the same workaround on hardware that lies.
        let forced = std::env::var_os("AEGIS_SOFTWARE_GL").is_some();
        let no_render_node = std::fs::read_dir("/dev/dri")
            .map(|entries| {
                !entries
                    .filter_map(Result::ok)
                    .any(|e| e.file_name().to_string_lossy().starts_with("renderD"))
            })
            .unwrap_or(true);
        let software_gl_likely = forced || no_render_node;

        if !dmabuf_operator_set && software_gl_likely {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if !compositing_operator_set && software_gl_likely {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }

        if !dmabuf_operator_set && !compositing_operator_set {
            if software_gl_likely {
                eprintln!(
                    "aegis: software GL detected/forced — webkit dmabuf+compositing disabled"
                );
            } else {
                eprintln!("aegis: hardware GL assumed — webkit compositing left enabled");
            }
        }
    }

    // `mut` is used only on Linux, where the single-instance plugin is added
    // below; off Linux the reassignment is compiled out, so silence the mut.
    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut builder = tauri::Builder::default();

    // Wayland Conduit Tier 3: the compositor keybind spawns `aegis --summon`,
    // a second process. The single-instance plugin intercepts it, forwards its
    // argv to THIS (the running) instance, and closes the intruder — so a
    // global hotkey works over native-Wayland windows without any client-side
    // key grab. Must be the first plugin registered. Linux-only: the summon
    // IPC is Wayland's need, and keeping it off Windows/macOS protects those
    // builds. A bare relaunch (no --summon) is refused, not toggled, so an
    // accidental double-launch never dismisses an open line.
    #[cfg(target_os = "linux")]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|a| a == "--summon") {
                toggle_breath(app);
            } else {
                eprintln!("aegis: already running (ignoring bare relaunch)");
            }
        }));
    }

    builder
        .manage(ask::AskState::from_env())
        .invoke_handler(tauri::generate_handler![
            dismiss_breath,
            submit_breath,
            facet_command,
            facet_targeted
        ])
        .setup(|app| {
            let film = app
                .get_webview_window("film")
                .expect("film window missing from tauri.conf.json");

            // The membrane spans the primary monitor edge to edge.
            if let Some(monitor) = film.primary_monitor()? {
                let pos = monitor.position();
                let size = monitor.size();
                film.set_position(PhysicalPosition::new(pos.x, pos.y))?;
                film.set_size(PhysicalSize::new(size.width, size.height))?;
            }

            // Focus/stacking hints must land before the surface maps —
            // the window is configured `visible: false` and shown here.
            overlay::apply(&film)?;
            film.show()?;

            // Law V made physical: the compositor routes every event through
            // to Reality. The Film is pure light. Must run after show() —
            // tao's input-shape call unwraps the GDK window, which only
            // exists once the surface is realized.
            film.set_ignore_cursor_events(true)?;

            // Verification hook (inert unless AEGIS_DEMO is set): drive the
            // Facet engine's scripted materialization through the Film webview,
            // the same eval path the Breath Line uses. Never fires in normal
            // operation — the real Facets are born from live WS task events.
            if std::env::var_os("AEGIS_DEMO").is_some() {
                let film2 = film.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    let film3 = film2.clone();
                    let _ = film2.run_on_main_thread(move || {
                        let _ = film3.eval("window.__aegis&&window.__aegis.demo()");
                    });
                });
            }

            // The Breath Line stays a hidden surface until the Conduit summons
            // it. Unlike the Film it MUST be able to take focus — it is the one
            // place the operator types (§9: focus by summon). hide/show handles
            // both visibility and focus hand-back (an unmap refocuses Reality).
            //
            // Pre-warm: the very first map of a webview is much slower than
            // later ones, so a cold first summon races an un-ready window and
            // the focus grab misses. Map it once off-screen now to realize the
            // surface, then hide — every summon thereafter maps fast.
            if let Some(breath) = app.get_webview_window("breath") {
                let _ = breath.set_position(PhysicalPosition::new(-4000, -4000));
                let _ = breath.show();
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    // If the operator summoned during the warm-up window, leave
                    // it up — hiding now would swallow their summon.
                    if !SUMMONED.load(Ordering::Acquire) {
                        if let Some(b) = handle.get_webview_window("breath") {
                            let b2 = b.clone();
                            let _ = b.run_on_main_thread(move || {
                                let _ = b2.hide();
                            });
                        }
                    }
                });
            }

            // Cold-start summon: if the compositor bind fired `aegis --summon`
            // while nothing was running yet, THIS process is the fresh primary
            // (single-instance had no one to forward to). Honor the intent once
            // the pre-warm has realized the surface, so the very first tap
            // still raises the line instead of silently just booting AEGIS.
            if std::env::args().any(|a| a == "--summon") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1300));
                    // toggle_breath dispatches its own body to the main thread.
                    toggle_breath(&handle);
                });
            }

            // Spawn the global Conduit hook; drive the Breath Line off its
            // gestures on a consumer thread that never blocks the hook.
            let (tx, rx) = std::sync::mpsc::channel::<ConduitEvent>();
            conduit::spawn(tx);
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("conduit-consumer".into())
                .spawn(move || {
                    for ev in rx {
                        match ev {
                            ConduitEvent::Tap => toggle_breath(&handle),
                            // Reserved for push-to-talk (§4.1); logged for now.
                            ConduitEvent::Hold => {
                                eprintln!("conduit: Hold (push-to-talk reserved)")
                            }
                        }
                    }
                })
                .expect("spawn conduit-consumer thread");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("aegis film failed to start");
}

/// Toggle the Breath Line. A hidden window unmaps (Reality gets focus back);
/// a shown one maps, centered, and takes focus. GTK ops run on the main thread.
fn toggle_breath(app: &AppHandle) {
    let Some(win) = app.get_webview_window("breath") else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        if SUMMONED.swap(false, Ordering::AcqRel) {
            let _ = win.hide();
        } else {
            SUMMONED.store(true, Ordering::Release);
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.eval("window.__breathFocus&&window.__breathFocus()");

            if conduit::is_wayland() {
                // Wayland: the compositor grants the keyboard to a freshly-shown
                // xdg-toplevel that requests activation — there is no X11
                // focus-stealing race to fight, and no X11 handle to the native
                // surface for pin_focus to even find. set_focus() above is the
                // job; re-assert once on the next tick to beat any activation-
                // token latency, then re-focus the input.
                let win2 = win.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    let win3 = win2.clone();
                    let _ = win2.run_on_main_thread(move || {
                        let _ = win3.set_focus();
                        let _ = win3.eval("window.__breathFocus&&window.__breathFocus()");
                    });
                });
            } else {
                // X11: Tauri's set_focus is WM-mediated and mutter's focus-
                // stealing guard can deny it. A direct XSetInputFocus is not
                // WM-mediated — but a *fixed* retry schedule only wins the race
                // while the board is idle; under load the line would map without
                // the keyboard, and every keystroke would silently land in the
                // host app. So keep re-asserting until the X server confirms we
                // hold focus, then focus the input.
                let win2 = win.clone();
                std::thread::spawn(move || {
                    if !conduit::pin_breath_focus() {
                        eprintln!("conduit: summon could not take focus — line left unsummoned");
                    }
                    let win3 = win2.clone();
                    let _ = win2.run_on_main_thread(move || {
                        let _ = win3.eval("window.__breathFocus&&window.__breathFocus()");
                    });
                });
            }
        }
    });
}

/// Route a Facet command from the Breath Line (the one window that owns focus)
/// to the Facet engine in the Film. Nothing is trusted: the action, the verb and
/// the spawn kind are each checked against a closed allowlist before anything is
/// forwarded, so only the six verbs of §2.2 can ever reach the engine. Delivery
/// is the proven `eval` path — no global grabs, no focus change, and the Film
/// stays click-through throughout.
#[tauri::command]
fn facet_command(
    app: AppHandle,
    action: String,
    verb: Option<String>,
    dir: Option<i32>,
    kind: Option<String>,
    text: Option<String>,
    question: Option<String>,
) -> Result<(), String> {
    const VERBS: [&str; 6] = ["approach", "recede", "pin", "feed", "cleave", "trace"];
    const KINDS: [&str; 4] = ["log", "dossier", "monitor", "answer"];

    match action.as_str() {
        "verb" => {
            let v = verb.as_deref().ok_or("verb missing")?;
            if !VERBS.contains(&v) {
                return Err(format!("unknown verb: {v}"));
            }
        }
        "target" => {
            if !matches!(dir, Some(1) | Some(-1)) {
                return Err("target dir must be +1 or -1".into());
            }
        }
        // The dive (§Law IV): +1 descends toward the ATLAS floor, -1 surfaces.
        "depth" => {
            if !matches!(dir, Some(1) | Some(-1)) {
                return Err("depth dir must be +1 or -1".into());
            }
        }
        "spawn" => {
            let k = kind.as_deref().ok_or("kind missing")?;
            if !KINDS.contains(&k) {
                return Err(format!("unknown facet kind: {k}"));
            }
        }
        other => return Err(format!("unknown action: {other}")),
    }

    let payload = serde_json::json!({
        "action": action, "verb": verb, "dir": dir,
        "kind": kind, "text": text, "question": question,
    });
    let film = app
        .get_webview_window("film")
        .ok_or("film window missing")?;
    film.eval(format!("window.__aegisCmd&&window.__aegisCmd({payload})"))
        .map_err(|e| e.to_string())
}

/// The Film reports which shard now holds the aim; the Breath Line names it
/// beneath the input so a verb is never fired blind.
#[tauri::command]
fn facet_targeted(app: AppHandle, label: Option<String>) -> Result<(), String> {
    let breath = app
        .get_webview_window("breath")
        .ok_or("breath window missing")?;
    let payload = serde_json::json!({ "label": label });
    breath
        .eval(format!("window.__breathTarget&&window.__breathTarget({payload})"))
        .map_err(|e| e.to_string())
}

/// Esc from within the Breath Line — recede (Law III: never a ✕, just hide).
#[tauri::command]
fn dismiss_breath(window: tauri::WebviewWindow) {
    SUMMONED.store(false, Ordering::Release);
    let _ = window.hide();
}

/// Enter in the Breath Line (§4.2): ask, and return the answer text to render
/// beneath the line. The window stays — only `Esc`/`dismiss_breath` recedes it
/// (Law III). An empty line is a no-op. Errors surface as a message the glass
/// can show, never a crash.
#[tauri::command]
async fn submit_breath(
    text: String,
    state: tauri::State<'_, ask::AskState>,
) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    state.ask(trimmed).await
}
