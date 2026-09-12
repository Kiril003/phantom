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

/// Як часто рядок бекенда їде на скло. Холодний старт — 2,5 хв і сотні
/// рядків (заміряно 12.09.2026 на артефакті 74469351, ноут під навантаженням);
/// чотири оновлення на секунду людина вже читає як живий рух.
const THROTTLE: std::time::Duration = std::time::Duration::from_millis(250);

fn main() {
    // `env_logger::init()` без `RUST_LOG` пропускає ЛИШЕ `error`. Через це
    // канал stdout/stderr сайдкара, заведений 29.08.2026 саме для того, щоб
    // бачити причину смерті, був німий у кожного, хто не знає про `RUST_LOG`:
    // 12.09.2026 у журналі власника перед `код=Some(1)` не було жодного рядка
    // `[backend]` — вони йдуть на `info`/`warn` і відкидались фільтром. Прилад,
    // вимкнений за замовчуванням, — це відсутній прилад.
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Будь-яка паніка на старті мусить стати видимою. Тут її ловлять ДО того,
    // як зʼявилось вікно: саме в цьому проміжку живуть «бракує WebView2»,
    // «не знайшов сайдкар» і «не зміг прочитати конфіг».
    std::panic::set_hook(Box::new(|info| {
        let text = format!(
            "PHANTOM OS не зміг стартувати.\n\n{info}\n\nПодробиці збережено у {}",
            std::env::temp_dir().join("phantom-os-startup.log").display()
        );
        leave_a_trace(&text);
        tell_the_user_out_loud("PHANTOM OS", &text);
    }));

    // Вікно PHANTOM малює Microsoft Edge WebView2. На Windows 11 він є завжди,
    // на Windows 10 — не обовʼязково, і портативна тека, на відміну від
    // інсталятора NSIS, не несе завантажувача (`webviewInstallMode` працює
    // лише в інсталяторі). Без цієї перевірки tauri панікує в `build()`, а
    // людина бачить порожнечу.
    #[cfg(windows)]
    if let Err(e) = tauri::webview_version() {
        let text = format!(
            "PHANTOM OS показує вікно через Microsoft Edge WebView2, \
             і на цій машині його немає.\n\n\
             Постав «Microsoft Edge WebView2 Runtime» (безкоштовний, від Microsoft) \
             і запусти PHANTOM ще раз.\n\n\
             Подробиця: {e}"
        );
        leave_a_trace(&text);
        tell_the_user_out_loud("PHANTOM OS — бракує WebView2", &text);
        std::process::exit(1);
    }

    tauri::Builder::default()
        // ПЕРШИМ, і це вимога плагіна, а не стиль: він мусить перехопити
        // запуск раніше, ніж решта почне робити роботу другого примірника.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            log::info!("другий примірник — піднімаю вікно першого");
            raise_the_existing_window(app);
        }))
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
        // `HOST`, а не `PHANTOM_HOST`. Заміряно 12.09.2026 на запакованому
        // сайдкарі: `config.py` — це `BaseSettings` БЕЗ `env_prefix`, тож поле
        // `host` читається зі змінної `HOST`; `HOST=0.0.0.0` справді доїжджає
        // в `config.host` і валить сторож V-4. Ім'я `PHANTOM_HOST` не читав
        // ніхто: єдина його згадка в усьому дереві — тест, що стеріг ЦЕЙ
        // рядок. Захист «у глибину» не вмикався жодного разу.
        .env("HOST", "127.0.0.1");

    // Перший елемент — потік подій із stdout/stderr дочірнього процесу.
    // Тут стояв `_`, і це коштувало нам сліпоти: 29.08.2026 у запакованому
    // застосунку бекенд не піднявся, а дізнатись причину було НІЗВІДКИ.
    // Плагін не успадковує stdio, він складає рядки у цей канал; викинувши
    // канал, ми викидали єдиний слід. Заставка при цьому радила «see logs» —
    // логів, яких не існує. Тепер кожен рядок іде в журнал оболонки, і
    // смерть sidecar видно поіменно, разом із кодом виходу.
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("spawn phantom-backend: {e}"))?;

    let app = handle.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        // Останній рядок бекенда — єдина причина смерті, яку взагалі можна
        // показати людині. Журнал оболонки їй недоступний: у запакованому
        // застосунку stderr нікуди не веде.
        let mut last_line = String::new();
        // Заставка показує, ЩО зараз робить ядро, і бере це звідси. Тротл — бо
        // холодний старт видає сотні рядків, а людині досить бачити, що вони
        // змінюються; кожен рядок окремим `eval` був би IPC на пусте місце.
        let mut last_push = std::time::Instant::now() - THROTTLE;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line).trim_end().to_string();
                    log::info!("[backend] {line}");
                    if !line.is_empty() {
                        last_line = line;
                        if last_push.elapsed() >= THROTTLE {
                            tell_the_splash_what_the_backend_is_doing(&app, &last_line);
                            last_push = std::time::Instant::now();
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line).trim_end().to_string();
                    log::warn!("[backend] {line}");
                    if !line.is_empty() {
                        last_line = line;
                        if last_push.elapsed() >= THROTTLE {
                            tell_the_splash_what_the_backend_is_doing(&app, &last_line);
                            last_push = std::time::Instant::now();
                        }
                    }
                }
                CommandEvent::Error(err) => {
                    log::error!("[backend] помилка каналу: {err}");
                    if !err.is_empty() {
                        last_line = err;
                    }
                }
                CommandEvent::Terminated(payload) => {
                    log::error!(
                        "[backend] процес завершився: код={:?} сигнал={:?}",
                        payload.code, payload.signal,
                    );
                    tell_the_splash_the_backend_died(
                        &app,
                        payload.code,
                        payload.signal,
                        &last_line,
                    );
                }
                _ => {}
            }
        }
    });

    let state: State<SidecarHandle> = handle.state();
    *state.0.lock().expect("sidecar handle poisoned") = Some(child);
    log::info!("phantom-backend sidecar started; PHANTOM_PACKAGED=1 host=127.0.0.1");
    Ok(())
}

/// Сказати людині вголос, коли вікна ще не існує.
///
/// У релізі під Windows стоїть `windows_subsystem = "windows"` — консолі немає,
/// stderr не веде НІКУДИ. Паніка на старті там виглядає так: людина двічі
/// клацає по exe, і не стається нічого. Ні вікна, ні помилки, ні сліду. Це та
/// сама вада, що «гріюсь 204s», лише коротша: прилад мовчить.
///
/// `MessageBoxW` — єдине, чим можна показати текст ДО того, як існує хоч одне
/// вікно застосунку.
#[cfg(windows)]
fn tell_the_user_out_loud(title: &str, body: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND, MB_TOPMOST,
    };
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let (body, title) = (wide(body), wide(title));
    // SAFETY: обидва рядки завершені нулем і живуть довше за виклик; вікна-
    // власника немає навмисно — його ще не існує.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR | MB_TOPMOST | MB_SETFOREGROUND,
        );
    }
}

/// На Linux stderr веде в журнал юніта, тож вікно не потрібне.
#[cfg(not(windows))]
fn tell_the_user_out_loud(title: &str, body: &str) {
    eprintln!("[{title}] {body}");
}

/// Слід, який переживе закрите вікно повідомлення.
///
/// Людина прочитає текст і натисне «ОК» — і якщо потім захоче показати його
/// нам, показувати буде нічого. Файл лежить у тимчасовій теці, бо вона
/// записна завжди, на відміну від теки поруч із застосунком.
fn leave_a_trace(text: &str) {
    let path = std::env::temp_dir().join("phantom-os-startup.log");
    let _ = std::fs::write(path, text);
}

/// Другий запуск мусить ПОКАЗАТИ те, що вже працює.
///
/// «PHANTOM уже запущено» на заставці — половина ліків: людина дізнається, що
/// сталось, і далі не має куди піти. Плагін `single-instance` віддає керування
/// першому примірнику, тож другий взагалі не дійде до сайдкара й не впреться
/// в зайнятий порт. Вікно могло бути мінімізоване або схованим — тому три дії,
/// а не одна: `unminimize` без `show` лишає схоже вікно схованим, а `show` без
/// `set_focus` виводить його за іншими.
fn raise_the_existing_window(app: &tauri::AppHandle) {
    match app.get_webview_window("main") {
        Some(window) => {
            let _ = window.unminimize();
            let _ = window.show();
            if let Err(e) = window.set_focus() {
                log::warn!("вікно не взяло фокус: {e}");
            }
        }
        None => log::error!("другий примірник: вікна «main» немає — піднімати нічого"),
    }
}

/// Те, що ядро каже про себе, мусить бути видно на заставці.
///
/// Заміряно 12.09.2026 на артефакті `74469351` (ноут під воротами й
/// емулятором): `/health` відповів через ~2,5 хв, і весь цей час заставка
/// показувала «гріюсь 204s» — тобто прилад описував ОЧІКУВАННЯ замість
/// роботи, яка насправді йшла й була видна в журналі рядок за рядком.
/// Лічильник без змісту читається як поломка; той самий лічильник поруч із
/// «завантажую голосові моделі» читається як робота.
fn tell_the_splash_what_the_backend_is_doing(app: &tauri::AppHandle, line: &str) {
    let line: String = line.chars().take(300).collect();
    let js = format!(
        "window.__PHANTOM_BACKEND_LINE__ = {};",
        serde_json::Value::String(line)
    );
    if let Some(window) = app.get_webview_window("main") {
        // Тихо: це кадр заставки, а не подія. Скаржитись на кожен рядок у
        // журнал означало б заповнити його собою.
        let _ = window.eval(&js);
    }
}

/// Смерть сайдкара мусить дійти до скла, а не лише в журнал.
///
/// 12.09.2026: бекенд пакунка завершився кодом 1, а заставка ще 204 секунди
/// бадьоро рахувала «гріюсь» — бо про `Terminated` знала тільки ця функція
/// логера. Тепер вікно дізнається код виходу й останній рядок бекенда.
///
/// `eval`, а не подія Tauri, свідомо: заставка — звичайний файл у `public/`
/// без збирача й без `window.__TAURI__` (у конфізі немає `withGlobalTauri`,
/// тека `capabilities/` не заведена). Слухач подій там потребував би і
/// того, і того; `evaluate_javascript` вебв'ю не потребує нічого й не
/// підпадає під CSP сторінки.
fn tell_the_splash_the_backend_died(
    app: &tauri::AppHandle,
    code: Option<i32>,
    signal: Option<i32>,
    last_line: &str,
) {
    // Рядок логу буває довгим (traceback в одному рядку); на склі 1024 px
    // від нього все одно видно початок, а він і несе причину.
    let last: String = last_line.chars().take(300).collect();
    let payload = serde_json::json!({
        "code": code,
        "signal": signal,
        "last": last,
    });
    // serde_json, а не format! — у рядку бекенда бувають лапки й зворотні
    // скіски, і склеєний вручну JS зламався б саме на найцікавішому рядку.
    let js = format!("window.__PHANTOM_BACKEND_DIED__ = {payload};");
    match app.get_webview_window("main") {
        Some(window) => {
            if let Err(e) = window.eval(&js) {
                log::error!("[backend] не зміг сказати склу про смерть ядра: {e}");
            }
        }
        None => log::error!("[backend] вікна «main» немає — сказати про смерть ядра нікому"),
    }
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
