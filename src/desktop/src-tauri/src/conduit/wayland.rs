//! Wayland Conduit backend — Tier 3 (compositor bind + summon IPC).
//!
//! On Wayland there is no equivalent of the X11 passive key grab: a client
//! cannot intercept a global key, by design. The honest path that works TODAY
//! is to let the *compositor* own the hotkey and have it poke a running AEGIS
//! over the single-instance IPC socket:
//!
//!     CapsLock ──(compositor keybind)──▶ `aegis --summon`
//!                                          │  tauri-plugin-single-instance
//!                                          ▼
//!                                 running AEGIS toggles the Breath Line
//!
//! Because the compositor consumes the key *before* any client sees it, this
//! covers every window — Wayland-native and Xwayland alike — which the X11
//! grab (Xwayland-only) cannot. This module detects the session and drops a
//! ready-to-source keybind snippet for the detected wlroots compositor
//! (Hyprland/Sway) into the app's own config dir. It NEVER edits the user's
//! compositor config — it writes a file and prints the one line to `source`.
//!
//! Portal-negotiated capture without a compositor bind is Tier 2 (portal.rs);
//! full evdev/uinput capture is a later stratum.

use std::path::PathBuf;

/// True when this process is talking to a Wayland display.
pub fn is_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Compositor {
    Hyprland,
    Sway,
    Other,
}

fn detect_compositor() -> Compositor {
    if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
        Compositor::Hyprland
    } else if std::env::var_os("SWAYSOCK").is_some() {
        Compositor::Sway
    } else {
        Compositor::Other
    }
}

/// `$XDG_CONFIG_HOME/aegis` or `$HOME/.config/aegis`.
fn config_dir() -> Option<PathBuf> {
    if let Some(x) = std::env::var_os("XDG_CONFIG_HOME") {
        if !x.is_empty() {
            return Some(PathBuf::from(x).join("aegis"));
        }
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config").join("aegis"))
}

/// Absolute path to this very binary, for the keybind's exec line. Falls back
/// to the bare name if the platform won't tell us (the user can then fix it).
fn exe_path() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(str::to_owned))
        .unwrap_or_else(|| "aegis".to_string())
}

/// Write the compositor keybind snippet and log how to activate it. Called
/// once at startup on a Wayland session. Overwrites each launch so the exec
/// path tracks the binary if it moves. Best-effort: any I/O failure is logged,
/// never fatal — the X11/Xwayland hook still runs as a partial fallback.
pub fn announce() {
    let exe = exe_path();
    let comp = detect_compositor();
    let dir = match config_dir() {
        Some(d) => d,
        None => {
            eprintln!(
                "conduit(wayland): no HOME/XDG_CONFIG_HOME — cannot write keybind snippet"
            );
            return;
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("conduit(wayland): cannot create {}: {e}", dir.display());
        return;
    }

    let (file, body, source_hint) = match comp {
        Compositor::Hyprland => {
            let f = dir.join("hypr-bind.conf");
            let hint = format!("source = {}", f.display());
            (f, hyprland_snippet(&exe), hint)
        }
        Compositor::Sway => {
            let f = dir.join("sway-bind.conf");
            let hint = format!("include {}", f.display());
            (f, sway_snippet(&exe), hint)
        }
        Compositor::Other => (dir.join("conduit-bind.txt"), generic_snippet(&exe), String::new()),
    };

    if let Err(e) = std::fs::write(&file, body) {
        eprintln!("conduit(wayland): cannot write {}: {e}", file.display());
        return;
    }

    match comp {
        Compositor::Other => eprintln!(
            "conduit(wayland): unknown compositor — wrote a keybind guide to {}. \
             Bind a key to `{} --summon` to arm the Conduit.",
            file.display(),
            exe
        ),
        _ => eprintln!(
            "conduit(wayland): Conduit keybind ready at {}. Add this line to your \
             compositor config and reload:\n    {source_hint}",
            file.display()
        ),
    }

    // Honest hint: a session bus means the Tier-2 GlobalShortcuts portal MIGHT
    // be reachable, but it is only scaffolded (portal.rs) — the compositor bind
    // above is the path in use.
    if super::portal::available() {
        eprintln!(
            "conduit(wayland): a D-Bus session is present — the GlobalShortcuts \
             portal (Tier 2) is scaffolded but not yet wired; using the \
             compositor bind for now."
        );
    }
}

fn hyprland_snippet(exe: &str) -> String {
    format!(
        "# PHANTOM AEGIS — the Conduit Key (auto-generated; safe to source).\n\
         # Activate:  add  `source = ~/.config/aegis/hypr-bind.conf`  to hyprland.conf, reload.\n\
         #\n\
         # CapsLock is the Conduit. To stop it also toggling caps-lock state,\n\
         # neutralise the key at the input layer (optional but recommended):\n\
         #     input {{ kb_options = caps:none }}\n\
         #\n\
         # A tap summons/dismisses the Breath Line. The compositor owns the key\n\
         # globally, so it works over every window — Wayland-native or Xwayland.\n\
         bind = , Caps_Lock, exec, {exe} --summon\n"
    )
}

fn sway_snippet(exe: &str) -> String {
    format!(
        "# PHANTOM AEGIS — the Conduit Key (auto-generated; safe to include).\n\
         # Activate:  add  `include ~/.config/aegis/sway-bind.conf`  to your sway config, reload.\n\
         #\n\
         # To stop CapsLock also toggling caps-lock state (optional):\n\
         #     input * xkb_options caps:none\n\
         #\n\
         # A tap summons/dismisses the Breath Line, globally.\n\
         bindsym Caps_Lock exec {exe} --summon\n"
    )
}

fn generic_snippet(exe: &str) -> String {
    format!(
        "PHANTOM AEGIS — the Conduit Key\n\
         ================================\n\n\
         Your Wayland compositor was not recognised (not Hyprland or Sway).\n\
         Bind a key of your choice to run:\n\n\
         \x20   {exe} --summon\n\n\
         A single running AEGIS receives the summon over its IPC socket and\n\
         toggles the Breath Line. Any compositor that can bind a key to a shell\n\
         command can arm the Conduit this way.\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyprland_snippet_binds_caps_to_summon_with_exe() {
        let s = hyprland_snippet("/opt/aegis/aegis");
        assert!(s.contains("bind = , Caps_Lock, exec, /opt/aegis/aegis --summon"));
        // The caps-neutralise hint is present so the key doesn't also lock caps.
        assert!(s.contains("caps:none"));
    }

    #[test]
    fn sway_snippet_binds_caps_to_summon_with_exe() {
        let s = sway_snippet("/opt/aegis/aegis");
        assert!(s.contains("bindsym Caps_Lock exec /opt/aegis/aegis --summon"));
    }

    #[test]
    fn generic_snippet_names_the_summon_invocation() {
        let s = generic_snippet("/opt/aegis/aegis");
        assert!(s.contains("/opt/aegis/aegis --summon"));
    }
}
