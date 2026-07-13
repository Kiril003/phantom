//! X11 Conduit backend.
//!
//! Strategy that satisfies "suppress the default, never desync the OS lock,
//! never touch another key" — and is crash-safe (mutates no global keyboard
//! state that would need restoring):
//!   1. Passive `GrabKey` on exactly the CapsLock keycode(s) with
//!      `ModMask::ANY`. A single-key passive grab intercepts only CapsLock —
//!      every other keystroke is delivered normally, untouched, so host-OS
//!      typing is structurally unaffected. No global keyboard grab, ever. The
//!      grab is released automatically by the server when our connection dies.
//!   2. On each CapsLock press, `LatchLockState` forces the `Lock` modifier
//!      back off. XKB's per-key LockMods action fires server-side regardless
//!      of the grab, so the naive approach desyncs; snapping the lock off on
//!      every press means the state never actually changes. Since apps never
//!      receive the (grabbed) keypress AND the lock stays off, typing stays
//!      lowercase. Nothing global is mutated, so a hard kill leaves no trace.
//!   3. `DetectableAutoRepeat` so a held key yields one clean release, not a
//!      storm of fake release/press pairs — the classifier stays simple.
//!
//! Under Wayland this connects to Xwayland and thus governs X11 clients only;
//! full-session capture there needs the portal or an evdev/uinput shim, which
//! is a later stratum. We log that honestly rather than pretend.

use std::sync::mpsc::Sender;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    AtomEnum, ConfigureWindowAux, ConnectionExt as _, GrabMode, InputFocus, ModMask, StackMode,
    Window,
};
use x11rb::protocol::xkb::{self, ConnectionExt as _};
use x11rb::protocol::Event;

use super::{classify, ConduitEvent, PressTracker};

const CAPS_LOCK_KEYSYM: u32 = 0xFFE5;

/// Pin focus onto a window and **verify it landed**, retrying until it does.
///
/// mutter mediates `_NET_ACTIVE_WINDOW` client messages through its focus-stealing
/// prevention, so Tauri's `set_focus` is intermittently denied; core `SetInputFocus`
/// is not WM-mediated and always lands. But issuing it once is still not enough: the
/// window's first map races the request, and mutter can hand the keyboard straight
/// back to the previously-active app. A fixed retry schedule wins that race only
/// while the board is idle — under load it loses, and the summon then *looks* fine
/// (the glass is on screen) while every keystroke goes to the host app. So we ask
/// the server who actually holds focus and keep re-asserting until the answer is us,
/// on one connection, stopping the instant it lands.
pub fn pin_focus(name: &str, attempts: u32, gap_ms: u64) -> bool {
    let Ok((conn, screen_num)) = x11rb::connect(None) else {
        return false;
    };
    let root = conn.setup().roots[screen_num].root;

    for _ in 0..attempts {
        if let Some(win) = find_named(&conn, root, name, 4) {
            let _ = conn.set_input_focus(InputFocus::PARENT, win, x11rb::CURRENT_TIME);
            let _ = conn.configure_window(
                win,
                &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE),
            );
            let _ = conn.flush();

            if let Ok(cookie) = conn.get_input_focus() {
                if let Ok(reply) = cookie.reply() {
                    if reply.focus == win {
                        return true;
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(gap_ms));
    }
    false
}

/// Breadth-limited search for a top-level window whose WM_NAME equals `name`.
fn find_named(conn: &impl Connection, win: Window, name: &str, depth: u8) -> Option<Window> {
    if depth == 0 {
        return None;
    }
    if window_name_is(conn, win, name) {
        return Some(win);
    }
    let children = conn.query_tree(win).ok()?.reply().ok()?.children;
    for child in children {
        if let Some(found) = find_named(conn, child, name, depth - 1) {
            return Some(found);
        }
    }
    None
}

fn window_name_is(conn: &impl Connection, win: Window, name: &str) -> bool {
    let Ok(cookie) = conn.get_property(false, win, AtomEnum::WM_NAME, AtomEnum::STRING, 0, 256)
    else {
        return false;
    };
    match cookie.reply() {
        Ok(reply) => String::from_utf8_lossy(&reply.value) == name,
        Err(_) => false,
    }
}

pub fn spawn(tx: Sender<ConduitEvent>) {
    std::thread::Builder::new()
        .name("conduit-x11".into())
        .spawn(move || {
            if let Err(e) = run(tx) {
                eprintln!("conduit(x11): {e}");
            }
        })
        .expect("spawn conduit-x11 thread");
}

fn run(tx: Sender<ConduitEvent>) -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        eprintln!(
            "conduit(x11): Wayland session — global capture covers Xwayland \
             clients only; native Wayland apps need the portal/evdev backend."
        );
    }

    let (conn, screen_num) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen_num].root;

    // One clean release per physical release, regardless of auto-repeat.
    conn.xkb_use_extension(1, 0)?.reply()?;
    conn.xkb_per_client_flags(
        xkb::ID::USE_CORE_KBD.into(),
        xkb::PerClientFlag::DETECTABLE_AUTO_REPEAT,
        xkb::PerClientFlag::DETECTABLE_AUTO_REPEAT,
        0u32.into(),
        0u32.into(),
        0u32.into(),
    )?
    .reply()?;

    // Find the CapsLock keycode(s) by keysym — robust regardless of the
    // current modifier map, and we never mutate that map.
    let targets = caps_lock_keycodes(&conn)?;
    if targets.is_empty() {
        return Err("no keycode maps to the Caps_Lock keysym".into());
    }

    // Intercept only our key(s). Grab under ANY modifier so NumLock/Shift/etc.
    // combinations still reach us.
    for &kc in &targets {
        conn.grab_key(false, root, ModMask::ANY, kc, GrabMode::ASYNC, GrabMode::ASYNC)?;
    }
    conn.flush()?;

    eprintln!(
        "conduit(x11): armed on keycode(s) {:?} — CapsLock is now the Conduit.",
        targets
    );

    let mut tracker = PressTracker::new();
    event_loop(&conn, &targets, &mut tracker, &tx)
}

/// Every keycode whose base keysym is Caps_Lock.
fn caps_lock_keycodes(
    conn: &impl Connection,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let setup = conn.setup();
    let min = setup.min_keycode;
    let max = setup.max_keycode;
    let count = max - min + 1;
    let mapping = conn.get_keyboard_mapping(min, count)?.reply()?;
    let per = mapping.keysyms_per_keycode as usize;
    let mut out = Vec::new();
    for (i, chunk) in mapping.keysyms.chunks(per).enumerate() {
        if chunk.iter().any(|&ks| ks == CAPS_LOCK_KEYSYM) {
            out.push(min + i as u8);
        }
    }
    Ok(out)
}

fn event_loop(
    conn: &impl Connection,
    targets: &[u8],
    tracker: &mut PressTracker,
    tx: &Sender<ConduitEvent>,
) -> Result<(), Box<dyn std::error::Error>> {
    loop {
        // Blocks with zero CPU at idle — honoring the §8 stillness/idle budget.
        let event = conn.wait_for_event()?;
        match event {
            Event::KeyPress(e) if targets.contains(&e.detail) => {
                // XKB keeps a per-key LockMods action that fires server-side,
                // independent of the core modifier map and of our grab — so the
                // press still toggles Lock. Snap it back off immediately: the
                // lock state never actually changes, so nothing can desync.
                let _ = conn.xkb_latch_lock_state(
                    xkb::ID::USE_CORE_KBD.into(),
                    ModMask::LOCK, // affect only the Lock modifier
                    ModMask::from(0u16), // set it to unlocked
                    false,
                    xkb::Group::M1,
                    ModMask::from(0u16),
                    false,
                    0,
                );
                let _ = conn.flush();
                tracker.press(e.time);
            }
            Event::KeyRelease(e) if targets.contains(&e.detail) => {
                if let Some(dwell) = tracker.release(e.time) {
                    if tx.send(classify(dwell)).is_err() {
                        return Ok(()); // UI gone; unwind and restore.
                    }
                }
            }
            _ => {}
        }
    }
}
