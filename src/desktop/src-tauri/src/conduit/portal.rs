// Scaffold module: the seam is intentionally ahead of its callers, so the
// unused entry points must not trip a warnings-as-errors build.
#![allow(dead_code)]

//! Tier 2 (scaffold) — the XDG GlobalShortcuts portal.
//!
//! `org.freedesktop.portal.GlobalShortcuts` is the sanctioned way for a native
//! or sandboxed app to register a global hotkey on Wayland WITHOUT a
//! compositor-specific keybind. It is the portable successor to the Tier-3
//! compositor-bind path (wayland.rs): where Tier 3 asks the user to source a
//! snippet, the portal negotiates the shortcut with the compositor at runtime
//! and — on backends that support it (GNOME/KDE, wlroots via xdg-desktop-
//! portal) — even lets the user rebind it through the desktop's own UI.
//!
//! This module is a SCAFFOLD. It documents the exact D-Bus flow and pins the
//! integration seam, but deliberately pulls in no `ashpd`/`zbus` yet — Tier 3
//! is the working path today, and a non-functional dependency tree is weight
//! the RAM-starved target does not need. It is wired nowhere by default.
//! Turning `try_bind_summon()` into the ashpd calls sketched below is all that
//! stands between this and a live Tier 2.
//!
//! Portal flow (org.freedesktop.portal.GlobalShortcuts v1):
//!   1. CreateSession()                          → a session handle
//!   2. BindShortcuts(session, [{id:"summon", …}], parent_window, opts)
//!        → the compositor prompts the user / auto-binds
//!   3. signal Activated(session, "summon", timestamp, opts)
//!        → on each activation, toggle the Breath Line (same sink as --summon)
//!   4. Deactivated / ShortcutsChanged keep local state honest.
//!
//! ashpd sketch (behind a future `portal` cargo feature):
//! ```ignore
//! let shortcuts = ashpd::desktop::global_shortcuts::GlobalShortcuts::new().await?;
//! let session = shortcuts.create_session().await?;
//! shortcuts
//!     .bind_shortcuts(&session,
//!         &[NewShortcut::new("summon", "Summon the Breath Line")],
//!         None)
//!     .await?;
//! let mut activated = shortcuts.receive_activated().await?;
//! while let Some(a) = activated.next().await {
//!     if a.shortcut_id() == "summon" { /* toggle_breath */ }
//! }
//! ```

/// Whether a portal backend is plausibly reachable (a session bus is present).
/// A `true` here is necessary, not sufficient — the GlobalShortcuts interface
/// may still be absent on an older backend; the real probe is the CreateSession
/// call in the (future) ashpd implementation.
pub fn available() -> bool {
    std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some()
}

/// Outcome of a Tier-2 bind attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortalStatus {
    /// The portal path is not built into this binary (no `portal` feature yet).
    NotBuilt,
}

/// Register the "summon" global shortcut via the portal. Scaffold: returns
/// `NotBuilt` until the ashpd implementation lands. Kept as the single, stable
/// seam so a future Wayland-first spawn path has one entry point to call.
pub fn try_bind_summon() -> PortalStatus {
    PortalStatus::NotBuilt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaffold_reports_not_built() {
        assert_eq!(try_bind_summon(), PortalStatus::NotBuilt);
    }
}
