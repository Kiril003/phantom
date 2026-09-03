"""Day-4 Wave-2 — Block V-1: Tauri 2.x scaffold contract pin
(ADR-DSH-001, `docs/architecture/desktop-shell.md`).

Closes audit U5-PKG-C1 (no desktop scaffold exists today).

The Tauri toolchain is NOT a CI dependency on this Day-4 build (no Rust
in the venv image; bundle artefacts live downstream of Day-5 signing).
Instead this test asserts the *files exist with the correct shape* —
the contract that downstream blocks (V-5 splash gate, W-3b settings UI
launcher, AB capstone tag) depend on.

Coverage:

1. Scaffold files exist at the canonical paths.
2. `Cargo.toml` lists Tauri 2.x + the shell plugin (sidecar host).
3. `tauri.conf.json` is valid JSON, sets `identifier`, declares
   `bundle.externalBin = ["binaries/phantom-backend"]`, and the splash
   window points at `splash.html` (NOT the dist bundle directly — the
   /readyz gate must run first).
4. `tauri.conf.json` window respects PHANTOM's 1024x600 hardware
   constraint as a min size (`min_width=1024`, `min_height=600`).
5. `src/main.rs` spawns the sidecar with `PHANTOM_PACKAGED=1` so
   `_refuse_lan_bind_in_packaged_mode` (`main.py:211`) activates.
6. CSP forbids cross-origin connect except 127.0.0.1:8000 (closes the
   "shell allows arbitrary fetch" sleeper concern).
7. The sidecar build helper exists and is executable.
"""
from __future__ import annotations

import json
import os
import re
import stat
from pathlib import Path

import pytest


# Resolve the repo root from this file: src/backend/tests/<this> →
# walk up three levels.
REPO_ROOT = Path(__file__).resolve().parents[3]
TAURI_DIR = REPO_ROOT / "src" / "frontend" / "src-tauri"
CARGO_TOML = TAURI_DIR / "Cargo.toml"
TAURI_CONF = TAURI_DIR / "tauri.conf.json"
MAIN_RS = TAURI_DIR / "src" / "main.rs"
# The splash moved out of src-tauri/ into the Vite public/ root in 5107435:
# from src-tauri/ it resolved `../dist/index.html`, which is a 404 in the
# packaged bundle, and its poll loop was inline against a `script-src 'self'`
# CSP. Served from public/ it lands beside index.html in dist/.
SPLASH_DIR = REPO_ROOT / "src" / "frontend" / "public"
SPLASH_HTML = SPLASH_DIR / "splash.html"
SPLASH_JS = SPLASH_DIR / "splash.js"
# Адреса бекенда переїхала сюди з трьох різних місць: заставка була ЄДИНОЮ,
# хто мав її зашитою правильно, а сокети будували хост від `window.location`
# і в пакунку йшли в нікуди. Тепер джерело одне, тож і сторож дивиться сюди.
BACKEND_ORIGIN_JS = SPLASH_DIR / "backend-origin.js"
BUILD_RS = TAURI_DIR / "build.rs"
SIDECAR_BUILD = REPO_ROOT / "scripts" / "build_sidecar.sh"


# ───────────────────────────────────────────────────────────── files exist ──


class TestScaffoldFilesExist:
    def test_cargo_toml_present(self):
        assert CARGO_TOML.is_file(), (
            f"V-1 regression: missing {CARGO_TOML.relative_to(REPO_ROOT)} — "
            "the Tauri crate manifest disappeared. Day-5 signing assumes "
            "this path; do not rename without updating ADR-DSH-001."
        )

    def test_tauri_conf_present(self):
        assert TAURI_CONF.is_file(), (
            f"V-1 regression: missing {TAURI_CONF.relative_to(REPO_ROOT)}"
        )

    def test_main_rs_present(self):
        assert MAIN_RS.is_file(), (
            f"V-1 regression: missing {MAIN_RS.relative_to(REPO_ROOT)}"
        )

    def test_splash_html_present(self):
        assert SPLASH_HTML.is_file(), (
            f"V-1 regression: missing splash gate {SPLASH_HTML.relative_to(REPO_ROOT)} — "
            "the /readyz poll lives there; without it the WebView opens before G2 done."
        )

    def test_splash_js_present(self):
        assert SPLASH_JS.is_file(), (
            f"V-1 regression: missing {SPLASH_JS.relative_to(REPO_ROOT)} — the poll "
            "loop cannot go back inline: the shipped CSP is script-src 'self'."
        )

    def test_build_rs_present(self):
        assert BUILD_RS.is_file()

    def test_sidecar_build_helper_present_and_executable(self):
        assert SIDECAR_BUILD.is_file(), (
            f"V-1 regression: missing {SIDECAR_BUILD.relative_to(REPO_ROOT)}"
        )
        mode = SIDECAR_BUILD.stat().st_mode
        assert mode & stat.S_IXUSR, (
            f"V-1: {SIDECAR_BUILD.name} not executable — `chmod +x` it back."
        )


# ─────────────────────────────────────────────────────────── Cargo manifest ──


class TestCargoManifest:
    def test_cargo_pins_tauri_v2_and_shell_plugin(self):
        body = CARGO_TOML.read_text(encoding="utf-8")
        # tauri-build under [build-dependencies], tauri + shell plugin under
        # [dependencies]. Lenient regex — just pin the major version.
        assert re.search(r'tauri\s*=\s*\{\s*version\s*=\s*"2\.', body), (
            "V-1: Cargo.toml must pin tauri = \"2.x\""
        )
        assert re.search(r'tauri-plugin-shell\s*=\s*"2\.', body), (
            "V-1: Cargo.toml must pin tauri-plugin-shell = \"2.x\" — "
            "the sidecar is spawned through ShellExt::sidecar()."
        )
        assert re.search(r'tauri-build\s*=\s*\{\s*version\s*=\s*"2\.', body), (
            "V-1: build-dependency tauri-build must be 2.x"
        )

    def test_cargo_release_profile_is_size_optimized(self):
        body = CARGO_TOML.read_text(encoding="utf-8")
        # Mobile-class device target — release profile must shave bytes.
        assert "lto = true" in body
        assert 'opt-level = "s"' in body
        assert "strip = true" in body


# ─────────────────────────────────────────────────────────── tauri.conf.json ──


class TestTauriConf:
    def _load(self) -> dict:
        return json.loads(TAURI_CONF.read_text(encoding="utf-8"))

    def test_identifier_and_product_name(self):
        conf = self._load()
        assert conf["identifier"] == "ai.phantom.os"
        assert conf["productName"] == "PHANTOM OS"

    def test_frontend_dist_points_at_react_bundle(self):
        conf = self._load()
        # `../dist` resolves from src-tauri/ to src/frontend/dist/, which is
        # exactly where `npm run build` writes its output.
        assert conf["build"]["frontendDist"] == "../dist"

    def test_window_respects_1024x600_hardware_floor(self):
        """PHANTOM ships on Radxa Q6A with a 7" 1024x600 panel. The shell
        window MUST NOT shrink below that — every UI screen is laid out
        exactly to those pixels (rule 3 of CLAUDE.md coding rules)."""
        conf = self._load()
        windows = conf["app"]["windows"]
        assert windows, "V-1: at least one window must be declared"
        main = windows[0]
        assert main["minWidth"] == 1024, (
            f"V-1: minWidth={main['minWidth']!r}, expected 1024 (Q6A panel width)"
        )
        assert main["minHeight"] == 600, (
            f"V-1: minHeight={main['minHeight']!r}, expected 600 (Q6A panel height)"
        )

    def test_window_opens_on_splash_not_dist(self):
        """The /readyz gate runs in splash.html. If the window opened on the
        dist bundle directly the React app would race the FastAPI lifespan."""
        conf = self._load()
        url = conf["app"]["windows"][0]["url"]
        assert url == "splash.html", (
            f"V-1: window must open splash.html (got {url!r}) — the splash "
            "page polls /readyz before navigating to the React bundle."
        )

    def test_external_bin_points_at_phantom_backend(self):
        """The PyInstaller sidecar drops phantom-backend-<triple> into
        src-tauri/binaries/. tauri.conf.json must reference the prefix
        Tauri's bundler expects."""
        conf = self._load()
        external = conf["bundle"]["externalBin"]
        assert external == ["binaries/phantom-backend"], (
            f"V-1: externalBin={external!r}, expected exactly "
            "['binaries/phantom-backend'] — Tauri's bundler appends the "
            "target triple suffix at build time."
        )

    def test_bundle_targets_cover_linux_and_windows(self):
        conf = self._load()
        targets = set(conf["bundle"]["targets"])
        # ARM64 Linux (Radxa Q6A primary) ships through .deb + .AppImage.
        # x86_64 Windows ships through .msi + .nsis.
        assert {"appimage", "deb"}.issubset(targets), (
            f"V-1: Linux bundle targets missing — got {targets!r}"
        )
        assert targets & {"msi", "nsis"}, (
            f"V-1: Windows bundle target missing — got {targets!r}"
        )

    def test_csp_locks_connect_to_loopback(self):
        """The shell HTML must NOT be able to fetch arbitrary origins.
        connect-src constrained to 127.0.0.1:8000 keeps a compromised
        WebView from exfiltrating to the public internet."""
        conf = self._load()
        csp = conf["app"]["security"]["csp"]
        assert "connect-src 'self' http://127.0.0.1:8000 ws://127.0.0.1:8000" in csp, (
            f"V-1: CSP connect-src must whitelist ONLY 127.0.0.1:8000 — got {csp!r}"
        )
        # No wildcards permitted in any directive.
        assert "*" not in csp, (
            f"V-1: CSP wildcard rejected — got {csp!r}"
        )

    def test_shell_plugin_does_not_open_arbitrary_paths(self):
        """tauri-plugin-shell is included to spawn the sidecar via
        ShellExt::sidecar(). The `open` capability (which would let the
        WebView shell out to xdg-open / start.exe) MUST stay disabled."""
        conf = self._load()
        shell_plugin = conf["plugins"]["shell"]
        assert shell_plugin["open"] is False, (
            "V-1: shell.open must be False — keep the WebView from launching "
            "external programs."
        )
        # `scope` was removed in 5107435: tauri-plugin-shell v2 panics at
        # startup on the key, and with `open: false` there is no command
        # surface for a scope to constrain. Absent is the safe state; an
        # empty list is a crash.
        assert "scope" not in shell_plugin, (
            f"V-1: shell.scope must be absent, not empty — got "
            f"{shell_plugin.get('scope')!r}; the key panics the shell on start."
        )


# ───────────────────────────────────────────────────────────────── main.rs ──


class TestMainRs:
    def _body(self) -> str:
        return MAIN_RS.read_text(encoding="utf-8")

    def test_main_rs_sets_phantom_packaged_env(self):
        """The refuse-LAN-bind guard (V-4, `main.py:211`) activates ONLY
        when PHANTOM_PACKAGED=1. If the shell forgets to set it, the
        backend would happily bind 0.0.0.0 inside the desktop installer."""
        body = self._body()
        assert '.env("PHANTOM_PACKAGED", "1")' in body, (
            "V-1 LEAK: main.rs must spawn the sidecar with "
            "PHANTOM_PACKAGED=1 — otherwise V-4 refuse-guard never fires."
        )

    def test_main_rs_pins_loopback_host(self):
        body = self._body()
        assert '.env("PHANTOM_HOST", "127.0.0.1")' in body, (
            "V-1: main.rs must set PHANTOM_HOST=127.0.0.1 (defence-in-depth "
            "alongside the V-4 refuse-guard)."
        )

    def test_main_rs_uses_shell_sidecar_api(self):
        body = self._body()
        assert "tauri_plugin_shell::ShellExt" in body
        assert ".sidecar(\"phantom-backend\")" in body, (
            "V-1: must spawn through ShellExt::sidecar — Tauri's bundler "
            "rewrites the path to binaries/<name>-<triple> at runtime."
        )

    def test_main_rs_terminates_sidecar_on_exit(self):
        body = self._body()
        # On RunEvent::ExitRequested or RunEvent::Exit the shell must call
        # kill() on the stored CommandChild handle. Without this the sidecar
        # leaks across app restarts and ports stay bound.
        assert "RunEvent::ExitRequested" in body
        assert "RunEvent::Exit" in body
        assert ".kill()" in body, (
            "V-1 LEAK: main.rs must kill() the sidecar on exit — orphan "
            "uvicorn keeps :8000 bound across re-launches."
        )

    def test_main_rs_windows_subsystem_is_windows_in_release(self):
        """Cosmetic but required: without the cfg_attr, a Windows release
        build pops a console window alongside the WebView."""
        body = self._body()
        assert "windows_subsystem" in body
        assert "all(not(debug_assertions), target_os = \"windows\")" in body


# ─────────────────────────────────────────────────────────── splash gate ──


class TestSplashHtml:
    def _body(self) -> str:
        """The gate is two files since 5107435 — the page and its poll loop."""
        return (
            SPLASH_HTML.read_text(encoding="utf-8")
            + "\n"
            + SPLASH_JS.read_text(encoding="utf-8")
        )

    def test_splash_loads_its_poll_loop_as_a_file(self):
        assert 'src="./splash.js"' in SPLASH_HTML.read_text(encoding="utf-8"), (
            "V-1: splash.html must load the poll loop from splash.js — an "
            "inline script is silently dropped by script-src 'self', which "
            "leaves the splash showing forever with nothing polling."
        )

    def test_splash_polls_readyz_loopback_only(self):
        """Заставка стукає в /readyz, і адресу бере з ЄДИНОГО джерела.

        Адреса більше не зашита в заставці рядком: вона рахується в
        `backend-origin.js`, бо той самий origin потрібен сокетам, які раніше
        будували хост від `window.location` і в пакунку йшли в нікуди. Тому
        сторож тепер тримає три речі окремо: заставка вантажить джерело,
        стукає саме в /readyz через нього, а джерело дає петлю 127.0.0.1.
        """
        body = self._body()
        assert 'src="./backend-origin.js"' in SPLASH_HTML.read_text(encoding="utf-8"), (
            "V-1: без backend-origin.js `window.__PHANTOM_BACKEND__` не існує, "
            "і петля опитування падає на першому ж рядку — заставка висить вічно."
        )
        assert "'/readyz'" in body or '"/readyz"' in body, (
            "V-1: the splash must poll /readyz — that's the gate ADR-DSH-001 binds to."
        )
        assert "__PHANTOM_BACKEND__" in body, (
            "V-1: адресу заставка мусить брати з єдиного джерела, а не збирати сама."
        )

        origin = BACKEND_ORIGIN_JS.read_text(encoding="utf-8")
        assert "'127.0.0.1'" in origin, (
            "V-1: джерело адреси мусить давати петлю 127.0.0.1 — саме її слухає бекенд."
        )
        # Belt-and-braces: nobody points the splash at a public URL.
        assert "http://localhost" not in body and "'localhost'" not in origin, (
            "V-1: the splash must use 127.0.0.1, not localhost — "
            "Windows IPv6 may resolve localhost to ::1 and the backend "
            "binds 127.0.0.1 only."
        )

    def test_splash_navigates_to_the_bundle_on_ok(self):
        body = self._body()
        # Served out of public/, the splash lands in dist/ beside index.html,
        # so the target is a sibling. The old `../dist/index.html` was written
        # for src-tauri/ and 404s in a packaged bundle.
        assert "'index.html'" in body, (
            "V-1: the splash must navigate to index.html on /readyz 200"
        )
        assert "../dist/" not in body, (
            "V-1: `../dist/` escapes the asset root in a packaged build — "
            "that path 404s and the user never leaves the splash."
        )

    def test_splash_never_stops_polling(self):
        """Заставка не має права здаватись — і не має права мовчати.

        Тут стояв сторож, що вимагав буквально `MAX_WAIT_MS` і `30000`, з
        обґрунтуванням «інакше застряглий sidecar лишить користувача перед
        чорним екраном назавжди». Побоювання правильне, число — ні:
        заміряно 29.08.2026 на зібраному AppImage, чотири запуски поспіль,
        бекенд відповідає через 37, 40, 45 і 47 секунд. Тобто заставка
        виносила вирок ЗАВЖДИ, на справному ядрі, яке піднімалось за
        кілька секунд ПІСЛЯ нього. Перший екран продукту звинувачував сам
        себе.

        Контракт свідомо змінено, і сторож переписаний під новий, а не
        знятий: чорного екрана боятись більше не треба (стан видно
        текстом), але й брехати не можна — того ж дня заставка з одним
        лише порогом терпіння тридцять три хвилини запевняла «ядро ще
        піднімається», коли sidecar не стартував узагалі.
        """
        body = self._body()

        assert "MAX_WAIT_MS" not in body, (
            "заставка повернулась до жорсткої межі очікування — саме вона "
            "виносила вирок справному ядру, що стартує 37-47 с"
        )
        assert "did not become ready" not in body, (
            "повернувся текст, що оголошує провал за розкладом, а не за фактом"
        )

        # 1. Опитування не має верхньої межі: цикл нескінченний, а не while
        #    із дедлайном.
        assert "for (;;)" in body, (
            "цикл опитування мусить бути нескінченним — якщо ядро колись "
            "відповість, застосунок має відкритись, а не лишитись на заставці"
        )

        # 2. Пороги — іменовані константи, а не числа, розсипані по коду.
        for const in ("PATIENCE_MS", "GIVEN_UP_MS"):
            assert f"const {const}" in body, (
                f"поріг {const} мусить бути константою — інакше наступна "
                "правка розсіє числа по файлу і зміст порогів загубиться"
            )

        # 3. Станів рівно три, і третій каже правду. Нескінченне «ще
        #    піднімається» — теж брехня, просто ввічлива.
        assert "гріюсь" in body, "немає стану звичайного прогріву"
        assert "довше, ніж звично" in body, (
            "немає стану «довше за звичне» — користувач мусить бачити, що "
            "система жива, а не застигла"
        )
        assert "не піднялося" in body, (
            "немає чесного стану відмови: після GIVEN_UP_MS заставка мусить "
            "визнати, що ядро не встало, а не запевняти зворотне безкінечно"
        )


# ─────────────────────────────────────────────────────── adr cross-check ──


class TestAdrCrossReference:
    def test_adr_desktop_shell_doc_present(self):
        """V-1 closes ADR-DSH-001. The ADR file is the contract of record;
        if it disappears the scaffold is unanchored."""
        adr = REPO_ROOT / "docs" / "architecture" / "desktop-shell.md"
        assert adr.is_file(), (
            "V-1: docs/architecture/desktop-shell.md missing — Phase-2 "
            "decisions evaporated."
        )
        body = adr.read_text(encoding="utf-8")
        assert "ADR-DSH-001" in body
        assert "_refuse_lan_bind_in_packaged_mode" in body
