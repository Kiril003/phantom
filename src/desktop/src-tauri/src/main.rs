#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod conduit;
mod overlay;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

use conduit::ConduitEvent;

fn main() {
    // webkitgtk's dmabuf renderer blanks the webview on software-GL stacks
    // (Adreno/VNC on this board: "DRI3 error" → black window). Respect an
    // operator-set value; default it off otherwise.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        // Software compositing survives window unmap/remap — the GL surface
        // path blanks a webview across hide→show on this stack (VNC/Adreno).
        // This lets the Breath Line's summon/dismiss use plain hide/show.
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dismiss_breath, submit_breath])
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
                    if let Some(b) = handle.get_webview_window("breath") {
                        let b2 = b.clone();
                        let _ = b.run_on_main_thread(move || {
                            let _ = b2.hide();
                        });
                    }
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
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.eval("window.__breathFocus&&window.__breathFocus()");
            // Tauri's set_focus is WM-mediated and mutter's focus-stealing
            // guard can deny it; a direct XSetInputFocus is not WM-mediated and
            // always lands. Retry across a few frames — the first-ever map of
            // the webview is slower than later ones. Then re-focus the input.
            let win2 = win.clone();
            std::thread::spawn(move || {
                for delay in [120u64, 130, 150] {
                    std::thread::sleep(std::time::Duration::from_millis(delay));
                    conduit::focus_breath();
                }
                let win3 = win2.clone();
                let _ = win2.run_on_main_thread(move || {
                    let _ = win3.eval("window.__breathFocus&&window.__breathFocus()");
                });
            });
        }
    });
}

/// Esc from within the Breath Line — recede (Law III: never a ✕, just hide).
#[tauri::command]
fn dismiss_breath(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

/// Enter in the Breath Line. Stratum 1 records the intent and recedes; the
/// answer-in-place pipeline (§4.2) lands in the next step.
#[tauri::command]
fn submit_breath(text: String, window: tauri::WebviewWindow) {
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        println!("[breath] {trimmed}");
    }
    let _ = window.hide();
}
