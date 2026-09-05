"""Керування випіканням дорожніх пакетів: що можна спекти, і що зараз печеться.

Окремий файл від `routes_bake.py` навмисно: там живе `/bake/capability`, і
його редагує сусідня сесія. Один префікс `/bake` на двох роутерах FastAPI
тримає без нарікань.

ДВІ ЧЕСНОСТІ, ЯКІ ЦЕЙ ФАЙЛ ОХОРОНЯЄ МЕХАНІЧНО, а не дисципліною автора знімка.

1. **Смуга випікання не має ні відсотка, ні решти часу.** Порахувати їх
   НЕМА З ЧОГО: скільки доріг у витягу, відомо лише коли його дочитано до
   кінця, тож жодне число до того моменту не є часткою від цілого.
   Намальований відсоток був би вигадкою, яка виглядає як вимір.
   `_FORBIDDEN_IN_BAKE` викидає такі ключі, хто б їх туди не поклав.
2. **Абсолютних шляхів у знімку немає.** Знімок їде по WS на спарені
   телефони — за межі машини. `/home/<ім'я>/...` у полі помилки віддав би
   ім'я власника й розкладку дисків кожному, хто слухає канал. Повідомлення
   не вирізаємо (людина має знати причину) — лишаємо від шляху останню ланку.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import re
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from db.models import User
from security.auth import TokenPayload, get_current_user, require_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bake", tags=["bake"])

# Усе, що вдає зі себе частку від цілого. Ключі викидаються з блоку `bake`
# незалежно від того, хто і навіщо їх туди поклав.
_FORBIDDEN_IN_BAKE = frozenset({
    "total", "totals", "percent", "pct", "progress", "fraction", "ratio",
    "eta", "eta_s", "eta_seconds", "remaining_s", "bytes_total", "items_total",
})

# Абсолютний шлях у POSIX або Windows — і ЛИШЕ абсолютний. Погляд позаду тут
# не прикраса: без нього вираз чіплявся за роздільник усередині слова, і
# `rel_path="road/phantom_road_mesh.kyiv.db"` (поле, з якого скло склеює шлях
# для кнопки «копіювати») ставав би «roadphantom_road_mesh.kyiv.db» — захист
# приватності мовчки псував би корисні дані.
_ABS_PATH = re.compile(r"""(?<![^\s"'(\[=,;])(?:[A-Za-z]:)?[/\\][^\s"',;]{2,}""")

_MIN_PROGRESS_GAP_S = 1.0


def _shorten(match: re.Match[str]) -> str:
    tail = re.split(r"[/\\]", match.group(0))[-1]
    return tail or "…"


def _scrub(node: Any) -> Any:
    """Рекурсивно зрізати абсолютні шляхи, лишивши сенс повідомлення."""
    if isinstance(node, dict):
        return {k: _scrub(v) for k, v in node.items()}
    if isinstance(node, (list, tuple)):
        return [_scrub(v) for v in node]
    if isinstance(node, str):
        return _ABS_PATH.sub(_shorten, node)
    return node


def _as_dict(status_obj: Any) -> dict[str, Any]:
    """JobStatus → dict, яким би він не був: dataclass, pydantic чи свій клас."""
    if isinstance(status_obj, dict):
        return dict(status_obj)
    for name in ("as_dict", "to_dict", "model_dump", "dict"):
        method = getattr(status_obj, name, None)
        if callable(method):
            try:
                out = method()
            except TypeError:
                continue
            if isinstance(out, dict):
                return out
    if dataclasses.is_dataclass(status_obj):
        return dataclasses.asdict(status_obj)
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Знімок роботи не вдалося перетворити на відповідь.",
    )


def public_snapshot(status_obj: Any) -> dict[str, Any]:
    """Знімок, який не соромно віддати назовні."""
    raw = _as_dict(status_obj)
    bake = raw.get("bake")
    if isinstance(bake, dict):
        raw["bake"] = {k: v for k, v in bake.items() if k not in _FORBIDDEN_IN_BAKE}
    return _scrub(raw)


def _name_the_pack(pack: Any) -> None:
    """Домалювати пакетові імʼя файла й відносний шлях — ЛИШЕ для REST.

    Ядро не емітує жодного шляху, навіть відносного: його знімок їде по WS на
    спарені телефони, і це правильна асиметрія. Але скло складає з
    `pack_root_abs` + `rel_path` рядок для кнопки «копіювати», а
    `pack_root_abs` живе саме тут, у REST. Тож і `rel_path` живе тут — виводиться,
    а не зберігається: імʼя детерміноване (`road/<pack_id>.db`, job.py:121,
    catalogue.py:59) і пришпилене тестом ядра. Хто прочитає WS-кадр і не
    знайде `rel_path`, має знати: це «лише REST, навмисно», а не вада ядра.
    """
    if not isinstance(pack, dict):
        return
    pack_id = pack.get("pack_id")
    if not isinstance(pack_id, str) or not pack_id:
        return
    pack.setdefault("filename", f"{pack_id}.db")
    pack.setdefault("rel_path", f"road/{pack['filename']}")


def rest_snapshot(status_obj: Any) -> dict[str, Any]:
    """`public_snapshot` + імʼя файла пакета. Для REST-відповідей, не для WS."""
    snap = public_snapshot(status_obj)
    _name_the_pack(snap.get("pack"))
    return snap


class BakeBroadcaster:
    """Гачок подій служби → канал WS «bake», із притлумленням.

    Служба не склеює тіки навмисно — притлумлення живе тут, бо тут видно,
    кому воно коштує: кожен тік це кадр кожному спареному телефону.
    Притлумлюється ЛИШЕ `job.progress` і лише поки етап той самий: зміна
    етапу — єдине, що людина справді читає в смузі, і затримати її на
    секунду означало б показати «завантаження», коли вже йде випікання.
    """

    def __init__(self) -> None:
        self._last_sent = 0.0
        self._last_stage: Optional[str] = None

    async def __call__(self, kind: str, status_obj: Any) -> None:
        snap = public_snapshot(status_obj)
        stage = snap.get("stage")
        now = time.monotonic()
        if (
            kind == "job.progress"
            and stage == self._last_stage
            and now - self._last_sent < _MIN_PROGRESS_GAP_S
        ):
            return
        self._last_stage = stage
        self._last_sent = now
        try:
            from api.websocket_hub import hub

            await hub.broadcast("bake", kind, snap)
        except Exception as exc:  # noqa: BLE001 — WS не має права валити випікання
            logger.warning("Випікання: подія %s не пішла в WS (%s)", kind, exc)


class StartBakeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope_id: str = Field(min_length=1, max_length=64)
    # Витяг уже на диску — перепитати мережу чи взяти лежаче. За
    # замовчуванням лежаче: 900 МБ качаються хвилинами, і мовчки платити за
    # них удруге тому, хто просто перепікає з новішим кодом, — грабунок.
    refresh_source: bool = False


def _service(request: Request) -> Any:
    svc = getattr(request.app.state, "bake_service", None)
    if svc is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Служба випікання не піднялась — дивись журнал старту вузла.",
        )
    return svc


def _require_operator(user: User) -> None:
    """Пекти й скасовувати — ROOT/OPERATOR. Дивитись може будь-хто свій."""
    role = getattr(user, "role", None) or getattr(user, "trust", None)
    if role and str(role).upper() not in {"ROOT", "OPERATOR"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Випікання пакетів — для ROOT/OPERATOR.",
        )


@router.get("/scopes")
async def bake_scopes(
    request: Request, _token: TokenPayload = Depends(require_auth)
) -> dict[str, Any]:
    """Що можна спекти на ЦІЙ машині — і чому решту не можна.

    `eligible` рахує бекенд, а не скло: клієнт не має ні порогів, ні
    поміряних чисел. Розміри витягів приходять з кешованого HEAD служби, не
    з константи: `remote.measured=false` означає «числа немає», і на склі не
    пишеться нічого — «приблизно 900 МБ» було б тією ж вигадкою-що-виглядає-
    як-вимір, що й відсоток у смузі.
    """
    from geo.bake_capability import probe_bake_capability

    svc = _service(request)
    caps = await probe_bake_capability()
    per_tier: dict[str, Any] = caps.get("per_scope") or {}

    scopes: list[dict[str, Any]] = []
    for entry in await svc.list_scopes():
        tier = entry.get("tier")
        verdict = per_tier.get(tier)
        if verdict is None:
            # Відмова без причини — це «червоне, що не вміє пояснити»,
            # дзеркало зеленого, що не вміє почервоніти. Не мовчимо.
            verdict = {
                "eligible": False,
                "blockers": [f"стелю для рівня «{tier}» не порахували"],
            }
        _name_the_pack(entry.get("existing_pack"))
        scopes.append({
            **entry,
            "eligible": bool(verdict.get("eligible")),
            "blockers": list(verdict.get("blockers") or []),
        })

    # ПІСЛЯ чистки і навмисно повз неї: єдиний законний абсолютний шлях тут,
    # і живе він рівно в REST-відповіді автентифікованому викликачеві (той
    # самий прецедент, що `chroma_path` у налаштуваннях). У WS-знімок він не
    # потрапляє ніколи — там є лише `rel_path`.
    from geo.bake_capability import pack_root

    return {
        # Пороги лишаються оцінками, і відповідь це каже вголос — те саме
        # слово, що й у `/bake/capability`, з того самого джерела.
        "estimate": bool(caps.get("estimate", True)),
        # Показання сторожа памʼяті ДО натискання — тим самим читачем, що
        # й під час роботи. Це реч про всю машину, не про обсяг, тому лежить
        # поруч зі `scopes`, а не всередині кожного.
        "memory": _scrub(svc.memory_state()),
        "scopes": _scrub(scopes),
        "sources": _scrub(await svc.list_sources()),
        "pack_root_abs": str(pack_root()).rstrip("/\\"),
    }


@router.get("/sources/{source_id}")
async def bake_source(
    source_id: str, request: Request, _token: TokenPayload = Depends(require_auth)
) -> dict[str, Any]:
    """Чи лежить витяг уже на диску."""
    state = await _service(request).source_state(source_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Такого джерела немає.")
    return _scrub(state)


@router.delete("/sources/{source_id}")
async def drop_bake_source(
    source_id: str, request: Request, user: User = Depends(get_current_user)
) -> dict[str, Any]:
    """Прибрати збережений витяг. Пакет, спечений з нього, лишається."""
    _require_operator(user)
    svc = _service(request)
    if await svc.source_state(source_id) is None:
        raise HTTPException(status_code=404, detail="Такого джерела немає.")
    return {"dropped": bool(await svc.drop_source(source_id))}


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
async def start_bake_job(
    req: StartBakeRequest, request: Request, user: User = Depends(get_current_user)
) -> dict[str, Any]:
    """Почати випікання. Одна робота за раз — на всю машину.

    412, а не 400: запит правильний, це машина не тягне. Текст причини
    приходить зі служби українською й показується людині дослівно.
    """
    _require_operator(user)
    # Спершу служба, і аж потім її винятки: коли служби немає, людина має
    # почути «не піднялась» (503), а не ImportError від модуля, у який ми
    # полізли, щоб назвати причину відмови, якої ще не сталось.
    svc = _service(request)
    from geo.bake.job import BakeAboveCeiling, BakeAlreadyRunning, BakeUnknownScope

    try:
        started = await svc.start(req.scope_id, refresh_source=req.refresh_source)
    except BakeUnknownScope as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except BakeAlreadyRunning as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except BakeAboveCeiling as exc:
        # Тіло руками, а не HTTPException: скло ключить копію відмови на
        # `reason` (low_memory / low_disk / unmeasured), а загальний
        # `request()` клієнта витягує з тіла помилки лише `detail` і `code`.
        # Тому `code` дублює `reason` — щоб слово доїхало й через звичайний
        # шлях помилок, а не лише до того, хто розбирає тіло сам.
        reason = getattr(exc, "reason", None)
        return JSONResponse(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            content={"detail": str(exc), "reason": reason, "code": reason},
        )
    return {"job": rest_snapshot(started)}


@router.get("/jobs/current")
async def current_bake_job(
    request: Request, _token: TokenPayload = Depends(require_auth)
) -> dict[str, Any]:
    """Живий знімок. Простій — це `job: null`, а не 204: одна гілка розбору
    на клієнті замість двох, з яких другу завжди хтось забуває."""
    running = _service(request).current()
    return {"job": rest_snapshot(running) if running is not None else None}


@router.get("/jobs/last")
async def last_bake_job(_token: TokenPayload = Depends(require_auth)) -> dict[str, Any]:
    """Останнє, що доробилось — з диска, а не з памʼяті служби.

    Саме з диска, бо найцінніший випадок цього виклику — після перезапуску:
    людина хоче знати, чим скінчилось те, що йшло, коли вузол упав.
    """
    from geo.bake_capability import pack_root

    try:
        doc = json.loads(
            (pack_root() / ".jobs" / "last.json").read_text(encoding="utf-8")
        )
    except (OSError, ValueError, UnicodeDecodeError):
        doc = None
    return {"job": rest_snapshot(doc) if isinstance(doc, dict) else None}


@router.delete("/jobs/current")
async def cancel_bake_job(
    request: Request,
    keep_download: Optional[bool] = None,
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Скасувати те, що йде. Нічого не йде — теж відповідь, а не помилка.

    `keep_download` доїжджає до служби, а не гине тут. Прапорець, який
    роутер прийняв і викинув, — це «мовчки нічого не робить» у чистому
    вигляді: людина натиснула «зупинити, витяг лишити», побачила зелене й
    недорахувалась 900 МБ аж наступного разу.

    ТРИ СТАНИ, А НЕ ДВА, і саме тому тут `None`, а не `True`. `None` —
    «людина нічого не казала», і служба бере налаштування
    `bake_keep_source_extracts`. `True`/`False` — «щойно натиснула», і воно
    б'є налаштування. Стояв тут `= True`, і це тихо вбивало третій стан:
    роутер завжди передавав би явне значення, налаштування не питали б
    НІКОЛИ, і щойно додана мною крутилка була б написана, показана людині
    в «Карті» — і не викликана жодного разу.
    """
    _require_operator(user)
    svc = _service(request)
    cancelled = bool(await svc.cancel("user", keep_download=keep_download))
    # Останній знімок, а не голий прапорець: скло малює ним кінцевий стан
    # картки, і `{cancelled: true}` без роботи лишило б його порожнім.
    remaining = svc.current()
    return {
        "cancelled": cancelled,
        "job": rest_snapshot(remaining) if remaining is not None else None,
    }


__all__ = ["router", "BakeBroadcaster", "public_snapshot", "rest_snapshot", "StartBakeRequest"]
