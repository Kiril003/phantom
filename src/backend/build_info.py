"""Паспорт збірки — один читач на весь вузол.

Навіщо. Вузол називав версію трьома різними голосами: `/healthz` віддавав
літерал `0.19.0-jarvis-online`, `/health` — літерал `0.1.0`, а
`tauri.conf.json` (те, що бачить людина в назві пакунка) казав `0.20.0`.
Жоден із трьох не був повʼязаний із тим, що справді зібрано. Скарга «в мене
зламалось на такій-то версії» була недоказовою за побудовою.

Тим часом `scripts/build_sidecar.sh` уже клав у бандл справжній паспорт —
`build_info.json` із комітом, ознакою брудного дерева, версією й часом
збірки. Його не читав НІХТО: паспорт без читача.

Цей модуль — той читач. Порядок джерел від найточнішого до найзагальнішого:
  1. `build_info.json` поруч із розпакованим бандлом PyInstaller
     (`sys._MEIPASS`) або поруч із виконуваним файлом — це те, ЩО СПРАВДІ
     ЗІБРАНО, разом із комітом;
  2. `tauri.conf.json` у дереві розробника — номер, який побачить людина;
  3. «dev» — і жодного вигаданого числа.

Ніколи не кидає: версія потрібна саме тоді, коли щось пішло не так.
"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

_FILENAME = "build_info.json"


def _bundle_dirs() -> list[Path]:
    dirs: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        dirs.append(Path(meipass))
    try:
        dirs.append(Path(sys.executable).resolve().parent)
    except (OSError, ValueError):
        pass
    return dirs


def _tauri_version() -> str | None:
    """Дерево розробника: номер, який людина побачить у назві пакунка."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        conf = parent / "src" / "frontend" / "src-tauri" / "tauri.conf.json"
        try:
            if conf.is_file():
                value = json.loads(conf.read_text(encoding="utf-8")).get("version")
                return str(value) if value else None
        except (OSError, ValueError, TypeError):
            return None
    return None


@lru_cache(maxsize=1)
def build_info() -> dict[str, Any]:
    """Паспорт збірки. `source` каже, звідки взято — інакше «0.20.0» з
    дерева розробника не відрізнити від «0.20.0» зі справжнього пакунка."""
    for directory in _bundle_dirs():
        path = directory / _FILENAME
        try:
            if not path.is_file():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            continue
        if isinstance(data, dict) and data.get("version"):
            return {
                "version": str(data.get("version")),
                "commit": str(data.get("commit") or "") or None,
                "dirty": bool(data.get("dirty")),
                "built_at": str(data.get("built_at") or "") or None,
                "component": str(data.get("component") or "") or None,
                "source": "bundle",
            }

    version = _tauri_version()
    if version:
        return {
            "version": version,
            "commit": None,
            # У дереві розробника «чисто» не буває доведеним: git тут не
            # питаємо навмисно, бо відповідь коштувала б процесу на кожен
            # /health. Невідоме краще позначити, ніж вигадати False.
            "dirty": None,
            "built_at": None,
            "component": "dev-tree",
            "source": "tauri.conf.json",
        }

    return {
        "version": "dev",
        "commit": None,
        "dirty": None,
        "built_at": None,
        "component": None,
        "source": "unknown",
    }


def version() -> str:
    return str(build_info()["version"])
