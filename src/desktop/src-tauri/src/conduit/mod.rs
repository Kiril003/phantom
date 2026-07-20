//! The Conduit Key — PHANTOM's dedicated nerve (AEGIS §4.1).
//!
//! One physical key (CapsLock, its native function a fossil) is hooked
//! globally, its default lock behavior suppressed, and its press/release
//! classified into gestures that summon the Breath Line. The hard part is
//! doing this across OSes without desyncing the OS lock state and without
//! ever touching a keystroke that isn't ours.
//!
//! Architecture: a pure, mockable classifier here; per-OS hook backends in
//! sibling modules feed `ConduitEvent`s over a channel to the UI thread.
//! The backend thread owns all platform I/O; the UI thread only shows glass.

use std::sync::mpsc::Sender;

#[cfg(target_os = "linux")]
mod linux_x11;
#[cfg(target_os = "linux")]
mod portal;
#[cfg(target_os = "linux")]
mod wayland;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

/// A gesture on the Conduit Key. Hold is reserved for push-to-talk (§4.1);
/// Stratum 1 wires only Tap → summon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConduitEvent {
    Tap,
    Hold,
}

/// Below this dwell a press is a tap (summon); at or above it, a hold.
pub const TAP_MAX_MS: u32 = 350;

/// Classify a completed press by how long the key was down.
pub fn classify(hold_ms: u32) -> ConduitEvent {
    if hold_ms < TAP_MAX_MS {
        ConduitEvent::Tap
    } else {
        ConduitEvent::Hold
    }
}

/// Tracks a single key's down-state across raw press/release events, folding
/// away auto-repeat. Ticks are millisecond timestamps (X11 server time /
/// Win32 GetTickCount), wrapping-subtracted so the 49-day u32 rollover is a
/// non-event. Platform-agnostic and clock-injected, hence unit-testable.
#[derive(Default)]
pub struct PressTracker {
    down_at: Option<u32>,
}

impl PressTracker {
    pub fn new() -> Self {
        Self { down_at: None }
    }

    /// Record a press. Returns `true` only for the genuine key-down —
    /// subsequent auto-repeat presses while still held return `false`.
    pub fn press(&mut self, tick: u32) -> bool {
        if self.down_at.is_none() {
            self.down_at = Some(tick);
            true
        } else {
            false
        }
    }

    /// Record a release. Returns the dwell duration in ms, or `None` if we
    /// never saw the matching press (spurious release).
    pub fn release(&mut self, tick: u32) -> Option<u32> {
        self.down_at.take().map(|d| tick.wrapping_sub(d))
    }
}

/// Pin focus onto the Breath Line and keep re-asserting until the X server
/// confirms we hold it. Returns false if it never landed. This is what makes the
/// summon trustworthy: a shown-but-unfocused line silently routes the operator's
/// keystrokes into the host app, which is worse than not summoning at all.
pub fn pin_breath_focus() -> bool {
    #[cfg(target_os = "linux")]
    {
        // ~1.2s of patience, abandoned the moment focus verifiably lands.
        return linux_x11::pin_focus("Breath Line", 20, 60);
    }
    #[cfg(not(target_os = "linux"))]
    false
}

/// True when this process is talking to a Wayland display (native surfaces,
/// compositor-owned hotkeys). Drives the summon-focus path in `toggle_breath`
/// and gates the compositor-bind announcement. Always false off Linux.
pub fn is_wayland() -> bool {
    #[cfg(target_os = "linux")]
    {
        return wayland::is_wayland();
    }
    #[cfg(not(target_os = "linux"))]
    false
}

/// Spawn the platform keyboard hook on its own thread. Returns immediately;
/// the hook lives for the process lifetime, emitting `ConduitEvent`s on `tx`.
pub fn spawn(tx: Sender<ConduitEvent>) {
    #[cfg(target_os = "linux")]
    {
        // Wayland: no client can grab a global key — the compositor owns it.
        // Drop a keybind snippet so a `Caps_Lock → aegis --summon` bind can
        // toggle us over single-instance IPC (see wayland.rs + main.rs). The
        // X11 hook still runs afterward for best-effort Xwayland coverage when
        // no compositor bind is set; the two never collide, because a present
        // compositor bind consumes the key before Xwayland ever sees it.
        if wayland::is_wayland() {
            wayland::announce();
        }
        linux_x11::spawn(tx);
    }
    #[cfg(target_os = "windows")]
    windows::spawn(tx);
    #[cfg(target_os = "macos")]
    macos::spawn(tx);
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        let _ = tx;
        eprintln!("conduit: no keyboard hook backend for this platform");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_splits_tap_from_hold_at_the_threshold() {
        assert_eq!(classify(0), ConduitEvent::Tap);
        assert_eq!(classify(TAP_MAX_MS - 1), ConduitEvent::Tap);
        assert_eq!(classify(TAP_MAX_MS), ConduitEvent::Hold);
        assert_eq!(classify(2_000), ConduitEvent::Hold);
    }

    #[test]
    fn tracker_measures_dwell() {
        let mut t = PressTracker::new();
        assert!(t.press(1_000));
        assert_eq!(t.release(1_120), Some(120));
    }

    #[test]
    fn tracker_folds_away_autorepeat() {
        let mut t = PressTracker::new();
        assert!(t.press(1_000)); // real key-down
        assert!(!t.press(1_040)); // auto-repeat — ignored
        assert!(!t.press(1_080)); // auto-repeat — ignored
        assert_eq!(t.release(1_500), Some(500));
    }

    #[test]
    fn tracker_ignores_release_without_press() {
        let mut t = PressTracker::new();
        assert_eq!(t.release(500), None);
    }

    #[test]
    fn tracker_survives_u32_wraparound() {
        let mut t = PressTracker::new();
        t.press(u32::MAX - 50);
        // 100ms later the clock has wrapped past zero.
        assert_eq!(t.release(49), Some(100));
    }

    #[test]
    fn tracker_rearms_after_release() {
        let mut t = PressTracker::new();
        t.press(10);
        t.release(30);
        assert!(t.press(100));
        assert_eq!(t.release(600), Some(500));
    }
}
