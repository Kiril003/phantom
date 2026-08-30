#!/usr/bin/env python3
"""Чи справді відкриє наш звуковий файл ТОЙ рушій, у якому живе застосунок.

Навіщо окремий зонд. `canPlayType` — це **обіцянка** рушія, і вона брехала:
Chromium казав про `audio/webm; codecs=opus` «probably», а WebKitGTK — на якому
Tauri працює під Linux — каже про нього порожній рядок, тобто «не вмію». Тому
зонд перевіряє не обіцянку, а **подію `loadedmetadata` з ненульовою
тривалістю**: рушій справді розібрав контейнер і знайшов доріжку.

Навіщо саме WebKitGTK. Tauri на Linux не несе свого рушія — він бере
системний `webkit2gtk`, а той не має кодеків узагалі й бере все з GStreamer.
Отже відповідь Chromium — це відповідь про стенд розробника, а не про машину
власника.

Використання:
    python3 scripts/webkit_can_play.py <файл.ogg>

Код виходу: 0 — рушій відкрив; 1 — не відкрив або не відповів. Друкує JSON.

ВАЖЛИВО про оточення. Плагіни й ядро GStreamer мусять бути з ОДНОГО набору.
Плагіни з пакунка проти системного ядра (і навпаки) дають розбіжність версій,
і мале число прийнятих плагінів у такому разі говорить **про зонд**, а не про
пакунок. Чистий вимір — там, де ядро й плагіни з одного джерела:

    GST_PLUGIN_SYSTEM_PATH_1_0=<AppDir>/usr/lib/gstreamer-1.0 \\
    GST_PLUGIN_SCANNER=<AppDir>/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner \\
    python3 scripts/webkit_can_play.py sample.ogg

Відомі межі:
  * WebKit вимагає `autoaudiosink` ЖОРСТКО. Без нього (пакет
    `gst-plugins-good`) процес падає ще до завантаження файлу, і підміна через
    `WEBKIT_GST_AUDIO_SINK=fakesink` чи `GST_AUDIO_SINK=fakesink` НЕ працює —
    обидві перевірені;
  * потрібен дисплей (`DISPLAY`/`WAYLAND_DISPLAY`). У контейнері — `xvfb-run`;
  * `Gtk.OffscreenWindow` не годиться: WebKit вимагає контекст GL. Звичайне
    вікно з `WEBKIT_DISABLE_COMPOSITING_MODE=1` і `LIBGL_ALWAYS_SOFTWARE=1`
    працює.
"""
from __future__ import annotations

import json
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

#: Скільки чекати на відповідь рушія. Декодування метаданих коротке; довше
#: означає, що елемента бракує і рушій мовчки не дійде до кінця.
DEADLINE_S = 20


def probe(path: str) -> dict:
    html = f"""<!doctype html><meta charset=utf-8><body><script>
    window.__s = {{stage: 'початок'}};
    const a = new Audio();
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => {{
      window.__s = {{stage: 'відкрито', duration: a.duration, readyState: a.readyState}};
    }});
    a.addEventListener('error', () => {{
      window.__s = {{stage: 'помилка', code: a.error && a.error.code}};
    }});
    a.src = 'file://{path}';
    a.load();
    </script></body>"""

    win = Gtk.Window()
    view = WebKit2.WebView()
    win.add(view)
    settings = view.get_settings()
    settings.set_allow_file_access_from_file_urls(True)
    settings.set_allow_universal_access_from_file_urls(True)

    out: dict = {}
    ticks = [0]

    def got(v, task):
        try:
            out.clear()
            out.update(json.loads(v.evaluate_javascript_finish(task).to_string()))
        except Exception as exc:  # noqa: BLE001
            out["помилка_зонда"] = str(exc)[:120]
        ticks[0] += 1
        if out.get("stage") in ("відкрито", "помилка") or ticks[0] > DEADLINE_S:
            Gtk.main_quit()

    def poll():
        view.evaluate_javascript("JSON.stringify(window.__s||{})", -1, None, None, None, got)
        return True

    def on_load(v, event):
        if event == WebKit2.LoadEvent.FINISHED:
            GLib.timeout_add(700, poll)

    view.connect("load-changed", on_load)
    view.load_html(html, "file:///")
    win.show_all()
    GLib.timeout_add_seconds(DEADLINE_S + 5, Gtk.main_quit)
    Gtk.main()
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("вкажіть шлях до звукового файлу", file=sys.stderr)
        return 2
    path = os.path.abspath(sys.argv[1])
    if not os.path.exists(path):
        print(f"немає файлу: {path}", file=sys.stderr)
        return 2

    result = probe(path) or {"stage": "рушій не відповів"}
    result["файл"] = path
    print(json.dumps(result, ensure_ascii=False, indent=1))

    # Тривалість — саме те, що відрізняє «розібрав контейнер» від «прийняв
    # рядок». Нуль тут означає, що доріжки рушій не знайшов.
    return 0 if result.get("stage") == "відкрито" and (result.get("duration") or 0) > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
