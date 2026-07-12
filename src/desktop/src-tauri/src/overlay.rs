//! Overlay physics per AEGIS §9: never steal focus, never enter the taskbar,
//! never be managed like an application window.
//!
//! Wayland (wlroots compositors): true layer-shell surface on the overlay
//! layer, keyboard interactivity None — build with `--features layer-shell`.
//! X11 / Mutter: GTK Dock type-hint + keep-above + focus refusal.

use tauri::WebviewWindow;

#[cfg(target_os = "linux")]
pub fn apply(win: &WebviewWindow) -> tauri::Result<()> {
    use gtk::prelude::*;

    let gtk_window = win.gtk_window()?;
    gtk_window.set_accept_focus(false);
    gtk_window.set_focus_on_map(false);
    gtk_window.set_type_hint(gdk::WindowTypeHint::Dock);
    gtk_window.set_keep_above(true);

    #[cfg(feature = "layer-shell")]
    if std::env::var("WAYLAND_DISPLAY").is_ok() && gtk_layer_shell::is_supported() {
        use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
        gtk_window.init_layer_shell();
        gtk_window.set_layer(Layer::Overlay);
        gtk_window.set_keyboard_mode(KeyboardMode::None);
        for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
            gtk_window.set_anchor(edge, true);
        }
        // Exclusive zone -1: span the true screen, ignoring panels/docks.
        gtk_window.set_exclusive_zone(-1);
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn apply(_win: &WebviewWindow) -> tauri::Result<()> {
    // Stratum 0 targets the Linux membrane; macOS/Windows join in a later
    // stratum with NSPanel / WS_EX_NOACTIVATE equivalents.
    Ok(())
}
