//! Windows Conduit backend — low-level keyboard hook (`WH_KEYBOARD_LL`).
//!
//! Contract with the OS: the hook callback runs on a system-critical path and
//! must be non-blocking, or Windows silently evicts the hook
//! (`LowLevelHooksTimeout`). So the callback does the absolute minimum —
//! read the tick, update two atomics, push to a lock-free channel, return —
//! and never touches a lock, syscall, or allocation.
//!
//! Suppressing the OS CapsLock toggle without desync: return `LRESULT(1)` for
//! our key. A suppressed key-down never reaches the system, so Windows never
//! flips the CapsLock state — the toggle we're worried about desyncing simply
//! never happens. Every other key is forwarded verbatim via `CallNextHookEx`,
//! so regular typing is structurally untouched.
//!
//! (Compiled only under `#[cfg(windows)]`; unverified on the Linux build host,
//! written to the documented Win32 contract.)

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
    HC_ACTION, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
    WM_SYSKEYUP,
};
use windows::Win32::UI::Input::KeyboardAndMouse::VK_CAPITAL;

use super::{classify, ConduitEvent, PressTracker};

static SENDER: OnceLock<Sender<ConduitEvent>> = OnceLock::new();
static DOWN_AT: AtomicU32 = AtomicU32::new(0);
static IS_DOWN: AtomicBool = AtomicBool::new(false);

// The classifier's press-folding lives in-callback via the two atomics above,
// mirroring PressTracker semantics without heap state. PressTracker itself is
// exercised by the cross-platform unit tests.
const _: fn() = || {
    let _ = PressTracker::new();
};

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if kb.vkCode == VK_CAPITAL.0 as u32 {
            let now = GetTickCount();
            match wparam.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => {
                    // swap(true): true only on the genuine key-down; auto-repeat
                    // key-downs find it already true and are folded away.
                    if !IS_DOWN.swap(true, Ordering::SeqCst) {
                        DOWN_AT.store(now, Ordering::SeqCst);
                    }
                }
                WM_KEYUP | WM_SYSKEYUP => {
                    if IS_DOWN.swap(false, Ordering::SeqCst) {
                        let dwell = now.wrapping_sub(DOWN_AT.load(Ordering::SeqCst));
                        if let Some(tx) = SENDER.get() {
                            let _ = tx.send(classify(dwell));
                        }
                    }
                }
                _ => {}
            }
            // Suppress: the OS never sees CapsLock, never toggles the lock.
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub fn spawn(tx: Sender<ConduitEvent>) {
    let _ = SENDER.set(tx);
    std::thread::Builder::new()
        .name("conduit-win".into())
        .spawn(|| unsafe {
            // LL hooks require a message loop on the installing thread.
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), HINSTANCE::default(), 0) {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("conduit(win): SetWindowsHookExW failed: {e}");
                    return;
                }
            };
            eprintln!("conduit(win): armed — CapsLock is now the Conduit.");
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = hook;
        })
        .expect("spawn conduit-win thread");
}
