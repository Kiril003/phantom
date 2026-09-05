"""Який обсяг випікання цей ПК може чесно запропонувати.

«Чи витримає ПК» досі було надією: продукт або відмовляв усім, або обіцяв
усім однаково. Тут воно стає перевіркою під час роботи — машина називає
власну стелю: місто → область → країна.

Три правила, які тримають цей модуль чесним:

1. **Міряти, а не припускати.** Вільне місце — на тій файловій системі, де
   пакети справді лежатимуть, а не на «/». Памʼять — доступна, а не
   встановлена. Здатність спекти — СПРОБОЮ ЗАПУСТИТИ робітника, а не
   пошуком модуля: `importlib.util.find_spec('osmium')` рапортує «є» і
   тоді, коли пакет розпакований наполовину, коли .so зібрано під іншу
   лібц, коли інтерпретатор бандла бачить не той site-packages. Спроба
   ловить усе це — і заразом доводить рівно той шлях запуску, яким піде
   справжнє випікання.
2. **Невідоме опускає стелю, ніколи не піднімає.** Не змогли поміряти диск —
   не обіцяємо нічого й кажемо чому.
3. **Пороги — оцінки, і так і підписані.** Скільки RAM з'їдає збирання графа
   маршрутів на всю Україну, ніхто ще не міряв. Поки не поміряно, число тут
   — стеля з запасом, а не факт. Але як тільки бодай один спечений пакет
   лишив по собі поміряний `peak_rss_bytes`, ми його показуємо ПОРУЧ з
   оцінкою — і, якщо він більший за оцінку, оцінку заміщає.

ЩО ЗМІНИЛОСЬ 05.09.2026: звідси прибрано docker. Не тому, що він
незручний, а тому, що `needs_docker=True` на обсязі «країна» стало
неправдою про цю машину: випікання тепер іде в самому процесі через
pyosmium (заміряно — Київ, витяг 39 МБ → 193 000 доріг / 216 947 рядків /
51 МБ за 15,7 с, без жодного контейнера). Умова, яка вимагає того, чого
код більше не питає, — це не запобіжник, а вигадана перешкода: вона
відмовляла б у «країні» цілком спроможній машині й називала б причиною
демон, до якого випікання не звертається.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_GIB = 1024 ** 3

# Скільки місця й памʼяті просить кожен обсяг. Джерело чисел — розділи 3 і 5
# плану мапи: вектор на країну ~1–1.9 ГБ, GLO-30 int16 ~0.5–0.95 ГБ, дорожня
# сітка 1.5 ГБ, плюс місце під розпакування й наступну версію поряд зі старою.
# Це оцінки з запасом, а не поміряні стелі.
BAKE_SCOPES: tuple[tuple[str, str, int, int], ...] = (
    # (id, назва, потрібно вільного диску, потрібно доступної RAM)
    ("city", "місто", 4 * _GIB, 2 * _GIB),
    ("oblast", "область", 16 * _GIB, 4 * _GIB),
    ("country", "країна", 64 * _GIB, 8 * _GIB),
)

_OSMIUM_PROBE_TIMEOUT_S = 6.0

# Рядок, який робітник друкує в режимі `--selftest`. Питаємо саме шлях, а не
# «ок»: у запакованій збірці єдине, що відрізняє живу прив'язку від чужої
# системної, — це де саме лежить модуль.
_OSMIUM_FROM_RE = re.compile(r"^osmium_from=(.+)$", re.MULTILINE)


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


def bake_worker_argv(*args: str) -> list[str]:
    """Як запустити робітника випікання з ЦЬОГО процесу.

    Дві розкладки, і різниця між ними не косметична. У дереві розробника
    робітник — це модуль (`-m geo.bake.worker`). У запакованій збірці модуля
    як файла немає взагалі: onefile тримає код усередині себе, а єдиний
    спосіб туди зайти — прапорець власного бінарника. Тому та сама функція
    дає обидва argv, і всі, хто спавнить робітника (проба тут і саме
    випікання), користуються нею — інакше проба довела б один шлях запуску,
    а продукт пішов би іншим.
    """
    if getattr(sys, "frozen", False):
        return [sys.executable, "--bake-worker", *args]
    return [sys.executable, "-m", "geo.bake.worker", *args]


async def probe_osmium() -> Measurement:
    """Спроба запустити робітника, а не пошук модуля.

    `find_spec('osmium')` — це `which docker` цього шару: він каже «є» про
    напіврозпакований пакет, про .so, зібраний під іншу лібц, і про модуль,
    видимий цьому інтерпретаторові, але не тому, яким піде спавн. Ми ж
    питаємо рівно те, що робитимемо: запусти робітника й скажи, звідки в
    тебе osmium.
    """
    argv = bake_worker_argv("--selftest")
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        # Це вимір, а не поломка: інтерпретатора/бінарника за цим шляхом
        # немає, отже спекти нічим. Кажемо «ні», а не «не знаю».
        return Measurement(0, True, f"нема чим запустити робітника: {argv[0]}")
    except OSError as exc:
        # А ось це вже НЕ вимір: fork не вдався (ліміт процесів, EMFILE) —
        # про osmium ми так нічого й не дізнались.
        return Measurement(None, False, f"не вдалося запустити робітника: {exc}")

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=_OSMIUM_PROBE_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return Measurement(
            None, False, f"робітник не відповів за {_OSMIUM_PROBE_TIMEOUT_S:.0f} с"
        )

    out = stdout.decode(errors="replace")
    match = _OSMIUM_FROM_RE.search(out)
    if proc.returncode == 0 and match:
        return Measurement(1, True, f"osmium з {match.group(1).strip()}")

    # Ненульовий код або мовчання про шлях — обидва означають «не спечемо».
    # Причину беремо з того, що робітник справді сказав, а не вигадуємо.
    said = (stderr.decode(errors="replace").strip() or out.strip()).splitlines()
    reason = said[-1][:200] if said else f"робітник вийшов з кодом {proc.returncode}"
    return Measurement(0, True, reason)


def read_measured_peaks(root: Optional[Path] = None) -> dict[str, int]:
    """Поміряні піки памʼяті з супутників уже спечених пакетів.

    Правило 3 казало «ніхто ще не міряв» і на тому спинялось — обіцянка
    поміряти колись. Це робить її механізмом: перший же спечений пакет
    лишає по собі число, і наступна відповідь стелі спирається вже на нього,
    а не на оцінку з запасом.

    Читання навмисно терпляче: супутник пише інша підсистема, і зіпсований
    або чужий JSON поруч із пакетами не має права звалити відповідь про
    здатність машини. Не прочитали — просто немає поміряного числа.
    """
    target = root or pack_root()
    peaks: dict[str, int] = {}
    try:
        candidates = sorted(target.glob("*.json")) + [target / ".jobs" / "last.json"]
    except OSError:
        return peaks
    for path in candidates:
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            continue
        if not isinstance(doc, dict):
            continue
        nested = doc.get("bake") if isinstance(doc.get("bake"), dict) else {}
        scope = doc.get("scope_id") or doc.get("scope") or nested.get("scope_id")
        rss = doc.get("peak_rss_bytes") or nested.get("peak_rss_bytes")
        # Супутник сам каже, чи він поміряв пік, чи лише здогадався (робітника
        # вбили раніше, ніж він прочитав VmHWM). Число без цього прапорця —
        # не вимір, і брати його як вимір означало б відтворити рівно ту ваду,
        # проти якої написаний увесь модуль: значення, що виглядає як факт.
        # Не поміряли — просто немає числа, і в силі лишається оцінка.
        if nested.get("measured") is False or doc.get("measured") is False:
            continue
        if not isinstance(scope, str) or not isinstance(rss, int) or rss <= 0:
            continue
        peaks[scope] = max(peaks.get(scope, 0), rss)
    return peaks


def required_ram(scope_id: str, estimate: int, peaks: dict[str, int]) -> int:
    """Оцінка або поміряний пік — той із них, що БІЛЬШИЙ.

    Асиметрія тут навмисна й вона і є правилом 2. Поміряний пік, вищий за
    оцінку, доводить, що оцінка була оптимістична: беремо його, і стеля
    опускається. Поміряний пік, НИЖЧИЙ за оцінку, не доводить нічого про
    інший витяг, іншу машину чи інший обсяг — узяти його означало б підняти
    стелю на підставі однієї вдалої спроби. Тому вниз він не тягне.
    """
    return max(estimate, peaks.get(scope_id, 0))


def offered_scope(
    *,
    disk: Measurement,
    ram: Measurement,
    osmium: Measurement,
    peaks: Optional[dict[str, int]] = None,
) -> dict[str, Any]:
    """Найбільший обсяг, який машина витягує — і чому не більший.

    Кожне невиміряне значення знімає всі обсяги, що його потребують. Тому
    невідоме опускає стелю, а не піднімає. Робітника потребують УСІ обсяги
    (без нього не печеться навіть місто), тож невиміряний osmium лишає
    «нічого» — і саме це правильна відповідь: ми не знаємо, чи спечемо.
    """
    granted: Optional[tuple[str, str]] = None
    blockers: list[str] = []
    # Той самий висновок у двох формах, і другу не можна виводити з першої.
    # Плоский `blockers` несе префікс «область: …», бо там він єдине, що
    # каже, ПРО ЯКИЙ обсяг мова. У `/bake/scopes` обсяг уже названий полем
    # `id`, і той самий префікс став би повтором у кожному рядку на склі.
    # Тому причини рахуються один раз тут, а не переписуються регуляркою
    # на боці роутера — інакше два формулювання розійшлись би на першій же
    # правці порогів, і людина побачила б різні причини на двох екранах.
    per_scope: dict[str, dict[str, Any]] = {}
    peaks = peaks or {}

    for scope_id, label, need_disk, estimate_ram in BAKE_SCOPES:
        need_ram = required_ram(scope_id, estimate_ram, peaks)
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
        if not osmium.measured:
            why.append(f"робітника випікання не вдалося перевірити ({osmium.detail})")
        elif not osmium.value:
            why.append(f"робітник випікання не працює: {osmium.detail}")

        per_scope[scope_id] = {"eligible": not why, "blockers": list(why)}
        if why:
            blockers.append(f"{label}: " + "; ".join(why))
        else:
            granted = (scope_id, label)

    return {
        "scope": granted[0] if granted else "none",
        "scope_ua": granted[1] if granted else "нічого",
        "blockers": blockers,
        "per_scope": per_scope,
        "estimate": True,
    }


def _gib(value: Optional[int]) -> str:
    if value is None:
        return "?"
    return f"{value / _GIB:.1f} ГіБ"


async def probe_bake_capability(pack_path: Optional[Path] = None) -> dict[str, Any]:
    disk = measure_free_disk(pack_path)
    ram = measure_available_ram()
    osmium = await probe_osmium()
    peaks = read_measured_peaks(pack_path)
    verdict = offered_scope(disk=disk, ram=ram, osmium=osmium, peaks=peaks)
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
            "osmium": {
                "usable": bool(osmium.value) if osmium.measured else False,
                "measured": osmium.measured,
                "detail": osmium.detail,
            },
        },
        "scopes": [
            {
                "id": scope_id,
                "label_ua": label,
                "needs_disk_bytes": need_disk,
                # Оцінка лишається на видноті навіть тоді, коли її замістив
                # поміряний пік: людина має бачити, що саме змінилось.
                "needs_ram_bytes": required_ram(scope_id, estimate_ram, peaks),
                "estimated_ram_bytes": estimate_ram,
                "measured_peak_rss_bytes": peaks.get(scope_id),
                "needs_osmium": True,
            }
            for scope_id, label, need_disk, estimate_ram in BAKE_SCOPES
        ],
    }
