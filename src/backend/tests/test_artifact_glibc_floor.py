"""Планка glibc не має права повзти вгору непоміченою.

Виміряно 29.08.2026. AppImage, зібраний на робочому ноутбуці (glibc 2.44),
не запускався НІДЕ, крім нього самого:

    debian:12-slim   glibc 2.36   падав
    debian:trixie    glibc 2.41   падав (просив 2.43)

Це не дефект коду, а закон динамічного лінкування: зібране під новішою
glibc не працює на старішій. Лікування — збирати в контейнері
`scripts/build-env.Dockerfile` (Ubuntu 22.04, glibc 2.35). Після переїзду
той самий бандл дає 200 на Debian 12, Ubuntu 22.04 і Fedora 40.

Цей сторож стереже, щоб наступна залежність не підняла планку тихо: тоді
ми дізнались би про це від першого користувача, а не від збірки.

ЧОГО ЦЕЙ СТОРОЖ НЕ БАЧИТЬ ЗА ПОБУДОВОЮ — читати перед тим, як йому вірити:

* Він дивиться на ЗОВНІШНІ бінарники. Той самий провал 29.08 стався в
  бібліотеці ВСЕРЕДИНІ архіву PyInstaller (`libsndfile`, підтягнута
  ctypes-ом), а зовнішній бінарник тоді показував безневинні 2.14. Тому
  нижче є друга перевірка — по розпакованому бандлу, якщо він поруч.
* Він не запускає нічого. Єдиний остаточний доказ — старт у чистому
  контейнері (`docker run --rm debian:12-slim …/phantom-backend`), і його
  не замінює жодне читання таблиць.
* Він мовчить, якщо артефактів немає: на машині без збірки стерегти нічого.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SIDECAR_DIR = REPO / "frontend" / "src-tauri" / "binaries"
SHELL_BIN = REPO / "frontend" / "src-tauri" / "target" / "release" / "phantom-os-shell"

# Ubuntu 22.04 — база оточення збірки. Усе, що просить більше, зібране не
# там, де слід. Число не з повітря: `scripts/build-env.Dockerfile` стоїть
# на 22.04 саме тому, що це найстаріша база, де ще є webkit2gtk-4.1
# (перевірено: 2.50.4-0ubuntu0.22.04.1), тобто найширше покриття, яке
# Tauri 2 взагалі дозволяє.
MAX_GLIBC = (2, 35)

GLIBC_RE = re.compile(rb"GLIBC_(\d+)\.(\d+)")


def _max_glibc(path: Path) -> tuple[int, int] | None:
    """Найвища вимога GLIBC_x.y у файлі, або None якщо їх немає."""
    try:
        raw = subprocess.run(
            ["objdump", "-T", str(path)], capture_output=True, timeout=120
        ).stdout
    except (FileNotFoundError, subprocess.SubprocessError):
        pytest.skip("objdump недоступний")
    found = [(int(a), int(b)) for a, b in GLIBC_RE.findall(raw)]
    return max(found) if found else None


def _fmt(v: tuple[int, int]) -> str:
    return f"{v[0]}.{v[1]}"


def _binaries() -> list[Path]:
    out: list[Path] = []
    if SIDECAR_DIR.is_dir():
        out += [
            p
            for p in SIDECAR_DIR.iterdir()
            if p.is_file() and p.name.startswith("phantom-backend")
        ]
    if SHELL_BIN.is_file():
        out.append(SHELL_BIN)
    return out


def test_built_artifacts_stay_within_the_glibc_floor():
    bins = _binaries()
    if not bins:
        pytest.skip("артефактів збірки немає — стерегти нічого")

    too_new = []
    for path in bins:
        got = _max_glibc(path)
        if got and got > MAX_GLIBC:
            too_new.append(f"{path.name}: GLIBC_{_fmt(got)}")

    assert not too_new, (
        "артефакт вимагає новішої glibc, ніж дає база збірки "
        f"({_fmt(MAX_GLIBC)}): " + "; ".join(too_new) + ". "
        "Найімовірніше, збирали на хості замість контейнера — "
        "запусти scripts/build_in_container.sh. Такий файл не запуститься "
        "ні на Debian 12, ні на Ubuntu LTS."
    )


def test_libraries_inside_the_bundle_stay_within_the_floor():
    """Друга перевірка — по вмісту, бо перша його не бачить.

    29.08 зовнішній бінарник показував GLIBC_2.14, а падало на
    `libsndfile.so`, яку PyInstaller кладе всередину архіву. Якщо поруч є
    розпакований onedir (`.build/pyinstaller/dist/phantom-backend/_internal`),
    перевіряємо і його.
    """
    internal = REPO.parent / ".build" / "pyinstaller" / "dist" / "phantom-backend" / "_internal"
    if not internal.is_dir():
        pytest.skip("розпакованого бандла поруч немає (onefile або не збирали)")

    too_new = []
    for so in list(internal.rglob("*.so")) + list(internal.rglob("*.so.*")):
        got = _max_glibc(so)
        if got and got > MAX_GLIBC:
            too_new.append(f"{so.name}: GLIBC_{_fmt(got)}")

    assert not too_new, (
        "бібліотеки всередині бандла вимагають новішої glibc, ніж база "
        f"збірки ({_fmt(MAX_GLIBC)}): " + "; ".join(sorted(set(too_new))[:10])
    )
