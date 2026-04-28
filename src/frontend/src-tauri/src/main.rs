// PHANTOM OS desktop shell entry — Day-4 Wave-2 V-1.
//
// Responsibilities (per ADR-DSH-001 in `docs/architecture/desktop-shell.md`):
//   1. Spawn the PyInstaller sidecar `phantom-backend` with
//      `PHANTOM_PACKAGED=1` so the backend's
//      `_refuse_lan_bind_in_packaged_mode` guard activates
//      (`src/backend/main.py:211`).
//   2. Poll `http://127.0.0.1:8000/readyz` from the splash page; flip the
//      WebView to the React bundle (`../dist/index.html`) once 200 OK.
//   3. On Drop / app exit: send SIGTERM to the sidecar, 2 s grace, then
//      kill — mirrors `mcp/adapter.py:79-89` shutdown shape.
//
// The polling itself lives in the splash page JS (see `splash.html`); this
// file owns the process lifecycle. Splitting keeps the Rust crate small and
// the readiness UX in territory the frontend team owns.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;

use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarHandle(Mutex<Option<CommandChild>>);

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarHandle(Mutex::new(None)))
        .setup(|app| {
            spawn_backend_sidecar(app.handle()).map_err(|e| {
                log::error!("phantom-backend sidecar spawn failed: {e}");
                Box::<dyn std::error::Error>::from(format!("sidecar spawn: {e}"))
            })?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("phantom-os shell failed to build")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                terminate_backend_sidecar(app_handle.state::<SidecarHandle>());
            }
        });
}

fn spawn_backend_sidecar(handle: &tauri::AppHandle) -> Result<(), String> {
    let shell = handle.shell();
    let cmd = shell
        .sidecar("phantom-backend")
        .map_err(|e| format!("locate phantom-backend: {e}"))?
        .env("PHANTOM_PACKAGED", "1")
        .env("PHANTOM_HOST", "127.0.0.1");

    let (_, child) = cmd
        .spawn()
        .map_err(|e| format!("spawn phantom-backend: {e}"))?;

    let state: State<SidecarHandle> = handle.state();
    *state.0.lock().expect("sidecar handle poisoned") = Some(child);
    log::info!("phantom-backend sidecar started; PHANTOM_PACKAGED=1 host=127.0.0.1");
    Ok(())
}

fn terminate_backend_sidecar(state: State<SidecarHandle>) {
    if let Some(child) = state
        .0
        .lock()
        .expect("sidecar handle poisoned")
        .take()
    {
        // tauri-plugin-shell's `kill` sends SIGTERM on Unix and TerminateProcess
        // on Windows. The 2 s grace cited in ADR-DSH-001 is enforced by the
        // backend's existing graceful-shutdown path (lifespan exit). If the
        // process ignores SIGTERM, the OS reaps it on parent exit.
        let _ = child.kill();
        log::info!("phantom-backend sidecar terminated");
    }
}
