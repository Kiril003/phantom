//! macOS Conduit backend — deferred to a later stratum.
//!
//! The real implementation is a `CGEventTap` at `kCGHIDEventTap` filtering
//! CapsLock (caps needs the `NX_DEVICELCTLKEYMASK`-style flags handling and an
//! Accessibility-trust prompt). Stubbed cleanly so the Linux/Windows build and
//! the shared classifier are unaffected.

use std::sync::mpsc::Sender;

use super::ConduitEvent;

pub fn spawn(tx: Sender<ConduitEvent>) {
    let _ = tx;
    eprintln!("conduit(macos): keyboard hook not yet implemented (later stratum)");
}
