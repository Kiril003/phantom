"""Який обсяг випікання цей ПК може чесно запропонувати.

«Чи витримає ПК» досі було надією: продукт або відмовляв усім, або обіцяв
усім однаково. Тут воно стає перевіркою під час роботи — машина називає
власну стелю: місто → область → країна.

Три правила, які тримають цей модуль чесним:

1. **Міряти, а не припускати.** Вільне місце — на тій файловій системі, де
   пакети справді лежатимуть, а не на «/». Памʼять — доступна, а не
   встановлена. Docker — спробою, а не пошуком файла: бінарник на місці,
   демон лежить, сокет без прав, rootless не піднявся — усе це `which
   docker` рапортує як «є».
2. **Невідоме опускає стелю, ніколи не піднімає.** Не змогли поміряти диск —
   не обіцяємо нічого й кажемо чому.
3. **Пороги — оцінки, і так і підписані.** Скільки RAM з'їдає збирання графа
   маршрутів на всю Україну, ніхто ще не міряв (U5 у плані). Поки не
   поміряно, число тут — стеля з запасом, а не факт.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_GIB = 1024 ** 3

# Скільки місця й памʼяті просить кожен обсяг. Джерело чисел — розділи 3 і 5
# плану мапи: вектор на країну ~1–1.9 ГБ, GLO-30 int16 ~0.5–0.95 ГБ, дорожня
# сітка 1.5 ГБ, плюс місце під розпакування й наступну версію поряд зі старою.
# Це оцінки з запасом, а не поміряні стелі.
BAKE_SCOPES: tuple[tuple[str, str, int, int, bool], ...] = (
    # (id, назва, потрібно вільного диску, потрібно доступної RAM, потрібен docker)
    ("city", "місто", 4 * _GIB, 2 * _GIB, False),
    ("oblast", "область", 16 * _GIB, 4 * _GIB, False),
    ("country", "країна", 64 * _GIB, 8 * _GIB, True),
)

_DOCKER_PROBE_TIMEOUT_S = 6.0


@dataclass(frozen=True)
class Measurement:
    """Одне вимірювання — і чи воно взагалі вдалось."""

    value: Optional[int]
    measured: bool
    detail: str = ""

    def as_dict(self, key: str) -> dict[str, Any]:
        return {key: self.value, "measured": self.measured, "detail": self.detail}


def pack_root() -> Path:
    """Тека, де лежатимуть пакети. Саме її файлову систему й міряємо."""
    from paths import resolve_data_dir

    return resolve_data_dir("map_packs")


def _nearest_existing(path: Path) -> Optional[Path]:
    """Теки ще може не бути — тоді міряємо найближчого предка, що існує.

    Міряти «/» замість неї було б брехнею в небезпечний бік: у користувача
    може бути крихітний root і великий /home, і навпаки.
    """
    candidate = path
    for _ in range(64):
        if candidate.exists():
            return candidate
        parent = candidate.parent
        if parent == candidate:
            return None
        candidate = parent
    return None


def measure_free_disk(path: Optional[Path] = None) -> Measurement:
    target = path or pack_root()
    existing = _nearest_existing(target)
    if existing is None:
        return Measurement(None, False, f"немає жодної існуючої теки над {target}")
    try:
        usage = shutil.disk_usage(existing)
    except OSError as exc:
        return Measurement(None, False, f"не вдалося прочитати {existing}: {exc}")
    return Measurement(int(usage.free), True, str(existing))


def measure_available_ram() -> Measurement:
    """Доступна памʼять, не встановлена.

    Встановлені 16 ГіБ нічого не кажуть про машину, де 15 із них уже зайняті.
    """
    try:
        import psutil

        return Measurement(int(psutil.virtual_memory().available), True, "psutil")
    except Exception:
        pass
    try:
        pages = os.sysconf("SC_AVPHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        if pages > 0 and page_size > 0:
            return Measurement(int(pages) * int(page_size), True, "sysconf")
    except (OSError, ValueError, AttributeError) as exc:
        return Measurement(None, False, f"sysconf недоступний: {exc}")
    return Measurement(None, False, "ні psutil, ні sysconf не відповіли")


async def probe_docker() -> Measurement:
    """Спроба, а не пошук бінарника.

    `docker info` звертається до демона. Тому воно ловить усе, що
    `which docker` пропускає: демон не запущений, сокет без прав, rootless
    не піднявся, контекст указує в нікуди.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "info",
            "--format",
            "{{.ServerVersion}}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return Measurement(0, True, "docker не встановлено")
    except OSError as exc:
        return Measurement(None, False, f"не вдалося запустити docker: {exc}")

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=_DOCKER_PROBE_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return Measurement(
            0, True, f"docker не відповів за {_DOCKER_PROBE_TIMEOUT_S:.0f} с"
        )

    if proc.returncode == 0:
        version = stdout.decode(errors="replace").strip() or "невідома версія"
        return Measurement(1, True, f"демон відповів: {version}")
    reason = stderr.decode(errors="replace").strip().splitlines()
    return Measurement(0, True, reason[0][:200] if reason else "docker info не вдався")


def offered_scope(
    *, disk: Measurement, ram: Measurement, docker: Measurement
) -> dict[str, Any]:
    """Найбільший обсяг, який машина витягує — і чому не більший.

    Кожне невиміряне значення знімає всі обсяги, що його потребують. Тому
    невідоме опускає стелю, а не піднімає.
    """
    granted: Optional[tuple[str, str]] = None
    blockers: list[str] = []

    for scope_id, label, need_disk, need_ram, need_docker in BAKE_SCOPES:
        why: list[str] = []
        if not disk.measured:
            why.append(f"вільне місце не поміряно ({disk.detail})")
        elif (disk.value or 0) < need_disk:
            why.append(
                f"вільного місця {_gib(disk.value)}, треба {_gib(need_disk)}"
            )
        if not ram.measured:
            why.append(f"доступну памʼять не поміряно ({ram.detail})")
        elif (ram.value or 0) < need_ram:
            why.append(f"доступної памʼяті {_gib(ram.value)}, треба {_gib(need_ram)}")
        if need_docker:
            if not docker.measured:
                why.append(f"docker не вдалося перевірити ({docker.detail})")
            elif not docker.value:
                why.append(f"docker недоступний: {docker.detail}")

        if why:
            blockers.append(f"{label}: " + "; ".join(why))
        else:
            granted = (scope_id, label)

    return {
        "scope": granted[0] if granted else "none",
        "scope_ua": granted[1] if granted else "нічого",
        "blockers": blockers,
        "estimate": True,
    }


def _gib(value: Optional[int]) -> str:
    if value is None:
        return "?"
    return f"{value / _GIB:.1f} ГіБ"


async def probe_bake_capability(pack_path: Optional[Path] = None) -> dict[str, Any]:
    disk = measure_free_disk(pack_path)
    ram = measure_available_ram()
    docker = await probe_docker()
    verdict = offered_scope(disk=disk, ram=ram, docker=docker)
    return {
        **verdict,
        "measured": {
            "disk": {
                "free_bytes": disk.value,
                "measured": disk.measured,
                "path": disk.detail if disk.measured else None,
                "detail": disk.detail,
            },
            "ram": ram.as_dict("available_bytes"),
            "docker": {
                "usable": bool(docker.value) if docker.measured else False,
                "measured": docker.measured,
                "detail": docker.detail,
            },
        },
        "scopes": [
            {
                "id": scope_id,
                "label_ua": label,
                "needs_disk_bytes": need_disk,
                "needs_ram_bytes": need_ram,
                "needs_docker": need_docker,
            }
            for scope_id, label, need_disk, need_ram, need_docker in BAKE_SCOPES
        ],
    }
