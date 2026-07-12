#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod overlay;

use tauri::{Manager, PhysicalPosition, PhysicalSize};

fn main() {
    // webkitgtk's dmabuf renderer blanks the webview on software-GL stacks
    // (Adreno/VNC on this board: "DRI3 error" → black window). Respect an
    // operator-set value; default it off otherwise.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .setup(|app| {
            let win = app
                .get_webview_window("film")
                .expect("film window missing from tauri.conf.json");

            // The membrane spans the primary monitor edge to edge.
            if let Some(monitor) = win.primary_monitor()? {
                let pos = monitor.position();
                let size = monitor.size();
                win.set_position(PhysicalPosition::new(pos.x, pos.y))?;
                win.set_size(PhysicalSize::new(size.width, size.height))?;
            }

            // Focus/stacking hints must land before the surface maps —
            // the window is configured `visible: false` and shown here.
            overlay::apply(&win)?;
            win.show()?;

            // Law V made physical: the compositor routes every event through
            // to Reality. The Film is pure light. Must run after show() —
            // tao's input-shape call unwraps the GDK window, which only
            // exists once the surface is realized.
            win.set_ignore_cursor_events(true)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("aegis film failed to start");
}
