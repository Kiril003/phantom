"""Ворота випікання: чи вони взагалі є, і чи знімок не бреше.

ПЕРШИЙ ТЕСТ ТУТ — НЕ ПРО ПРАВИЛЬНІСТЬ, А ПРО ДОСЯЖНІСТЬ, і це навмисно.

Цей дім уже тричі за два дні знаходив підсистему написану, покриту тестами
й не викликану ЖОДНОГО разу: TLS-слухач, якого ніхто не піднімав, перевірку
шляху, порахувану й не застосовану, сторожа підпису, що нікому не заважає.
Тест, який питає «чи правильно рахує ця функція», зелений і в мертвому коді
— він доводить, що функція працює, і мовчить про те, що до неї нема як
дійти. Тому тут спершу питається `app.routes`: якщо роутер випікання
відпаде від `main.py`, ЦЕЙ файл почервоніє, а не наступний реліз.

Решта — про дві обіцянки, які знімок дає людині й телефону: у смузі
випікання немає вигаданого відсотка, і назовні не тече жоден абсолютний
шлях.
"""
from __future__ import annotations

import sys
import types

import pytest

from api.routes_bake_jobs import BakeBroadcaster, public_snapshot

# Що мусить бути змонтоване. Шлях і метод разом: роут, що загубив DELETE,
# так само зламаний, як і роут, якого немає.
REQUIRED_ROUTES: tuple[tuple[str, str], ...] = (
    ("/api/v1/bake/capability", "GET"),
    ("/api/v1/bake/scopes", "GET"),
    ("/api/v1/bake/sources/{source_id}", "GET"),
    ("/api/v1/bake/sources/{source_id}", "DELETE"),
    ("/api/v1/bake/jobs", "POST"),
    ("/api/v1/bake/jobs/current", "GET"),
    ("/api/v1/bake/jobs/current", "DELETE"),
    ("/api/v1/bake/jobs/last", "GET"),
)


def test_every_bake_route_is_actually_mounted_on_the_app():
    """Сторож досяжності. Валиться, якщо роут випікання зник із застосунку."""
    from main import create_app

    app = create_app()
    mounted = {
        (route.path, method)
        for route in app.routes
        for method in getattr(route, "methods", set()) or set()
    }
    missing = [pair for pair in REQUIRED_ROUTES if pair not in mounted]
    assert not missing, (
        "роути випікання не змонтовані: "
        + ", ".join(f"{m} {p}" for p, m in missing)
        + " — код може бути написаний і покритий тестами, але людина до нього "
        "не дійде"
    )


# ── Підробна служба ──────────────────────────────────────────────────────────
#
# `geo/bake/*` пише сусідній агент. Щоб не чекати на нього і — головне — щоб
# ці тести лишились про РОУТЕР, а не про випікання, ставимо в sys.modules
# модуль із тими самими іменами винятків. Коли справжній приїде, monkeypatch
# так само підмінить його на час тесту й поверне назад.


class _Boom(Exception):
    pass


@pytest.fixture
def fake_bake(monkeypatch):
    mod = types.ModuleType("geo.bake.job")

    class BakeAlreadyRunning(_Boom):
        pass

    class BakeAboveCeiling(_Boom):
        # Та сама форма, що в geo/bake/job.py: (reason, message_ua).
        def __init__(self, reason: str, message_ua: str):
            super().__init__(message_ua)
            self.reason = reason

    class BakeUnknownScope(_Boom):
        pass

    mod.BakeAlreadyRunning = BakeAlreadyRunning
    mod.BakeAboveCeiling = BakeAboveCeiling
    mod.BakeUnknownScope = BakeUnknownScope
    monkeypatch.setitem(sys.modules, "geo.bake.job", mod)
    return mod


class _Service:
    """Мінімум, якого вистачає роутерові. Нічого не пече."""

    def __init__(self, *, raises=None, running=None):
        self._raises = raises
        self._running = running
        self.cancelled_with: list[tuple[str, bool]] = []
        self.started_with: dict | None = None

    async def start(self, scope_id: str, *, refresh_source: bool = False):
        self.started_with = {"scope_id": scope_id, "refresh_source": refresh_source}
        if self._raises is not None:
            raise self._raises
        return {"job_id": "j1", "scope_id": scope_id, "stage": "preflight"}

    def current(self):
        return self._running

    async def cancel(self, reason: str, *, keep_download=None) -> bool:
        self.cancelled_with.append((reason, keep_download))
        return self._running is not None


def _install(client, service) -> None:
    client.app.state.bake_service = service


async def test_a_second_job_is_a_conflict_not_a_second_job(auth_root_client, fake_bake):
    _install(auth_root_client, _Service(
        raises=fake_bake.BakeAlreadyRunning("уже печеться «місто»")
    ))
    resp = auth_root_client.post("/api/v1/bake/jobs", json={"scope_id": "kyiv"})
    assert resp.status_code == 409, resp.text
    assert "печеться" in resp.json()["detail"]


async def test_above_the_ceiling_is_412_and_carries_the_reason(auth_root_client, fake_bake):
    """412, а не 400: запит правильний — це машина не тягне.

    І причина мусить доїхати дослівно: «не можна» без «чому» — це відмова,
    після якої людина не знає, що робити.
    """
    _install(auth_root_client, _Service(
        raises=fake_bake.BakeAboveCeiling("low_memory", "доступної памʼяті 1.2 ГіБ, треба 4.0 ГіБ")
    ))
    resp = auth_root_client.post("/api/v1/bake/jobs", json={"scope_id": "ukraine"})
    assert resp.status_code == 412, resp.text
    body = resp.json()
    assert "треба 4.0 ГіБ" in body["detail"]
    # Слово, на яке скло ключить копію, — і його дубль у `code`, бо
    # загальний request() клієнта витягує з помилки лише detail і code.
    assert body["reason"] == "low_memory"
    assert body["code"] == "low_memory"


async def test_an_unknown_scope_is_404(auth_root_client, fake_bake):
    _install(auth_root_client, _Service(raises=fake_bake.BakeUnknownScope("немає такого")))
    assert auth_root_client.post(
        "/api/v1/bake/jobs", json={"scope_id": "atlantis"}
    ).status_code == 404


async def test_a_started_job_answers_202(auth_root_client, fake_bake):
    _install(auth_root_client, _Service())
    resp = auth_root_client.post("/api/v1/bake/jobs", json={"scope_id": "kyiv"})
    assert resp.status_code == 202, resp.text
    assert resp.json()["job"]["scope_id"] == "kyiv", "старт мусить нести ту саму обгортку"


async def test_refresh_source_reaches_the_service(auth_root_client, fake_bake):
    """Прапорець, який роутер прийняв і викинув, — це мовчазне нічого.

    Скло шле `refresh_source` у тілі; поки модель стояла з extra=forbid і без
    цього поля, старт із фронтенда просто отримував 422.
    """
    svc = _Service()
    _install(auth_root_client, svc)
    resp = auth_root_client.post(
        "/api/v1/bake/jobs", json={"scope_id": "kyiv", "refresh_source": True}
    )
    assert resp.status_code == 202, resp.text
    assert svc.started_with == {"scope_id": "kyiv", "refresh_source": True}


async def test_keep_download_reaches_the_service(auth_root_client):
    """«Зупини, але витяг лишись» — 900 МБ, які людина не має качати вдруге."""
    svc = _Service(running={"job_id": "j1", "stage": "cancelled"})
    _install(auth_root_client, svc)
    resp = auth_root_client.delete("/api/v1/bake/jobs/current?keep_download=false")
    assert resp.status_code == 200, resp.text
    assert svc.cancelled_with == [("user", False)]
    assert resp.json()["cancelled"] is True
    assert resp.json()["job"]["stage"] == "cancelled", "скло малює цим кінець картки"


async def test_saying_nothing_leaves_the_choice_to_the_setting(auth_root_client):
    """Три стани, а не два — інакше налаштування мертве.

    `None` мусить доїхати до служби НЕЗАЙМАНИМ, бо саме він означає «людина
    нічого не казала, візьми bake_keep_source_extracts». Підставити тут
    `True` означало б, що роутер завжди відповідає за людину, налаштування
    не питають ніколи, і крутилка в «Карті» — написана, показана й не
    викликана.
    """
    svc = _Service(running={"job_id": "j1", "stage": "cancelled"})
    _install(auth_root_client, svc)
    auth_root_client.delete("/api/v1/bake/jobs/current")
    assert svc.cancelled_with == [("user", None)]


async def test_an_explicit_keep_download_beats_the_setting(auth_root_client):
    svc = _Service(running={"job_id": "j1", "stage": "cancelled"})
    _install(auth_root_client, svc)
    auth_root_client.delete("/api/v1/bake/jobs/current?keep_download=true")
    assert svc.cancelled_with == [("user", True)]


async def test_idle_is_a_job_of_null_not_an_empty_body(auth_root_client):
    """Простій — це стан, і він має форму. 204 змусив би клієнта мати другу
    гілку розбору, яку рано чи пізно хтось забуде."""
    _install(auth_root_client, _Service(running=None))
    resp = auth_root_client.get("/api/v1/bake/jobs/current")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"job": None}


async def test_no_service_is_503_not_a_silent_empty_answer(auth_root_client):
    auth_root_client.app.state.bake_service = None
    assert auth_root_client.get("/api/v1/bake/jobs/current").status_code == 503


async def test_reading_needs_auth(unauth_client):
    for path in ("/api/v1/bake/scopes", "/api/v1/bake/jobs/current", "/api/v1/bake/jobs/last"):
        assert unauth_client.get(path).status_code in (401, 403), path


async def test_starting_needs_auth(unauth_client):
    assert unauth_client.post(
        "/api/v1/bake/jobs", json={"scope_id": "kyiv"}
    ).status_code in (401, 403)


async def test_the_scopes_shape_is_the_one_the_glass_is_typed_against(auth_root_client):
    """Заморожена форма `/bake/scopes` — скло вже привʼязане до неї.

    І головне тут — `eligible`/`blockers` рахує БЕКЕНД. У клієнта немає ні
    порогів, ні поміряної памʼяті; будь-яке його «здається, потягну» було б
    здогадкою, показаною людині як вирок.
    """
    class _Catalogue(_Service):
        async def list_scopes(self):
            return [
                {"id": "kyiv", "tier": "city", "label_ua": "Київ",
                 "source_id": "ukraine", "bbox": None,
                 "existing_pack": {"pack_id": "phantom_road_mesh.kyiv", "bytes": 51_000_000},
                 "previous": None},
                {"id": "atlantis", "tier": "нема-такого", "label_ua": "Атлантида",
                 "source_id": "ukraine", "bbox": None,
                 "existing_pack": None, "previous": None},
            ]

        def memory_state(self):
            return {"ram_available_pct": 61.0, "floor_pct": 30, "strikes_to_trip": 3,
                    "poll_s": 1.0, "measured": True, "would_stop": False,
                    "psi_some_avg10": 0.0}

        async def list_sources(self):
            return [{
                "id": "ukraine", "label_ua": "Україна",
                "host": "download.geofabrik.de",
                "url": "https://download.geofabrik.de/europe/ukraine-latest.osm.pbf",
                "remote": {"bytes": None, "last_modified": None,
                           "measured": False, "measured_at": None,
                           "detail": "HEAD не відповів"},
                "on_disk": None, "partial": None,
            }]

    _install(auth_root_client, _Catalogue())
    body = auth_root_client.get("/api/v1/bake/scopes").json()

    assert isinstance(body["estimate"], bool)
    assert body["pack_root_abs"] and not body["pack_root_abs"].endswith("/")
    # Сторож памʼяті видимий у спокої, ДО натискання — і саме числами, щоб
    # скло не зашивало «30» у код.
    assert body["memory"]["floor_pct"] == 30
    assert body["memory"]["would_stop"] is False
    assert body["memory"]["measured"] is True

    kyiv = next(s for s in body["scopes"] if s["id"] == "kyiv")
    assert set(kyiv) >= {"id", "tier", "label_ua", "source_id", "bbox",
                         "eligible", "blockers", "existing_pack", "previous"}
    assert isinstance(kyiv["eligible"], bool)
    assert kyiv["existing_pack"]["rel_path"] == "road/phantom_road_mesh.kyiv.db", (
        "наявний пакет теж має бути скопійовним"
    )

    # Рівень, якого стеля не знає, мусить отримати ПРИЧИНУ, а не мовчазне «ні».
    lost = next(s for s in body["scopes"] if s["id"] == "atlantis")
    assert lost["eligible"] is False
    assert lost["blockers"], "відмовили без жодного слова — червоне, що не пояснює"

    src = body["sources"][0]
    assert src["remote"]["measured"] is False and src["remote"]["bytes"] is None
    assert src["url"].startswith("https://download.geofabrik.de/"), (
        "адресу джерела зіпсувала чистка шляхів"
    )


# ── Знімок: дві обіцянки ─────────────────────────────────────────────────────


def test_the_bake_stage_carries_no_percent_no_eta_no_total():
    """Найважливіший тест файлу після сторожа досяжності.

    Скільки доріг у витягу, відомо лише коли його дочитано. Будь-який
    відсоток до того — вигадка, що виглядає як вимір.
    """
    snap = public_snapshot({
        "stage": "baking",
        "bake": {
            "ways_seen": 12, "rows_written": 40, "elapsed_s": 3.0,
            "percent": 41, "eta_s": 90, "bytes_total": 999, "progress": 0.41,
        },
    })
    for forbidden in ("percent", "eta_s", "bytes_total", "progress"):
        assert forbidden not in snap["bake"], f"{forbidden} просочився у смугу"
    assert snap["bake"]["ways_seen"] == 12, "чесні лічильники не мали постраждати"


def test_measured_sizes_and_guard_numbers_pass_through_untouched():
    """Дзеркало заборони вище: чесний ВИМІР не є часткою від цілого.

    `output_bytes`/`index_bytes` — stat() файла на кожному тіку, знак життя
    між скидами по 5 000 рядків; `guard` — числа сторожа, щоб скло не
    зашивало 30 у код. Викинь їх заборонний список за схожість на «total» —
    і смуга мовчки осліпне на пів хвилини між скидами, при зелених тестах
    на чесність.
    """
    snap = public_snapshot({
        "stage": "baking",
        "guard": {"floor_pct": 30, "strikes_to_trip": 3, "poll_s": 1.0},
        "bake": {"ways_seen": 5, "output_bytes": 4096, "index_bytes": None},
    })
    assert snap["guard"] == {"floor_pct": 30, "strikes_to_trip": 3, "poll_s": 1.0}
    assert snap["bake"]["output_bytes"] == 4096
    assert "index_bytes" in snap["bake"] and snap["bake"]["index_bytes"] is None, (
        "null до появи файла — це «ще нема», і воно має доїхати як null"
    )


def test_no_absolute_path_leaves_the_machine():
    """Знімок їде по WS на спарені телефони — тобто за межі машини."""
    snap = public_snapshot({
        "stage": "failed",
        "outcome": {
            "kind": "error",
            "detail_ua": "не прочитав /home/kyrylo/phantom/map_packs/kyiv.osm.pbf",
        },
    })
    text = snap["outcome"]["detail_ua"]
    assert "/home/kyrylo" not in text
    assert "kyiv.osm.pbf" in text, "від причини мусить лишитись сенс, а не пустка"


def test_a_relative_pack_path_survives_the_scrubbing():
    """Дзеркальний бік: захист приватності не має права псувати корисні дані.

    `rel_path` — це те, з чого скло склеює шлях для кнопки «копіювати».
    Порізаний навпіл, він мовчки давав би людині шлях, якого немає.
    """
    snap = public_snapshot({
        "pack": {
            "rel_path": "road/phantom_road_mesh.kyiv.db",
            "filename": "phantom_road_mesh.kyiv.db",
        },
    })
    assert snap["pack"]["rel_path"] == "road/phantom_road_mesh.kyiv.db"
    assert snap["pack"]["filename"] == "phantom_road_mesh.kyiv.db"


def test_source_urls_and_relative_paths_survive_the_scrubbing():
    """Другий бік того самого леза, і найдорожчий, якби я його проґавив.

    Наївний вираз «косá риска = шлях» зʼїв би КОЖНУ адресу джерела:
    `https://download.geofabrik.de/…` перетворився б на `ukraine-latest.osm.pbf`,
    і завантаження мовчки перестало б працювати — при повністю зелених
    тестах на приватність.
    """
    from api.routes_bake_jobs import _scrub

    payload = {
        "url": "https://download.geofabrik.de/europe/ukraine-latest.osm.pbf",
        "host": "download.geofabrik.de",
        "on_disk": {"rel_path": "sources/ukraine-latest.osm.pbf"},
        "partial": {"rel_path": ".tmp/ukraine-latest.osm.pbf.part"},
        "remote": {"last_modified": "Wed, 04 Sep 2026 12:00:00 GMT"},
    }
    assert _scrub(payload) == payload


# ── Притлумлення ─────────────────────────────────────────────────────────────


class _Hub:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []
        self.frames: list[dict] = []

    async def broadcast(self, channel, type_, data, **_kw):
        self.sent.append((channel, type_))
        self.frames.append(data)


@pytest.fixture
def spy_hub(monkeypatch):
    import api.websocket_hub as mod

    hub = _Hub()
    monkeypatch.setattr(mod, "hub", hub)
    return hub


async def test_progress_is_throttled_to_one_per_second(spy_hub):
    caster = BakeBroadcaster()
    for _ in range(20):
        await caster("job.progress", {"stage": "baking"})
    assert len(spy_hub.sent) == 1, "двадцять тіків за мить = двадцять кадрів телефону"
    assert spy_hub.sent[0] == ("bake", "job.progress")


async def test_a_stage_change_is_never_delayed(spy_hub):
    """Етап — єдине, що людина справді читає в смузі."""
    caster = BakeBroadcaster()
    await caster("job.progress", {"stage": "downloading"})
    await caster("job.progress", {"stage": "baking"})
    await caster("job.progress", {"stage": "baking"})
    assert len(spy_hub.sent) == 2, "зміну етапу притлумили разом із тіками"


async def test_lifecycle_events_are_never_throttled(spy_hub):
    caster = BakeBroadcaster()
    for kind in ("job.started", "job.stage", "job.finished", "pack.visible"):
        await caster(kind, {"stage": "baking"})
    assert [t for _c, t in spy_hub.sent] == [
        "job.started", "job.stage", "job.finished", "pack.visible"
    ]


# ── rel_path: REST так, WS ні ─────────────────────────────────────────────────
#
# Ядро не емітує жодного шляху — його кадр їде на спарені телефони. Скло ж
# складає `pack_root_abs + "/" + rel_path` для кнопки «копіювати», і обидві
# половини мають жити в одному місці: у REST. До цієї пари тестів rel_path
# не виробляв НІХТО — ядро за дизайном, я думав, що лише зберігаю чуже, — і
# кнопка копіювала б голий pack_id при цілком зелених тестах.

_DONE = {"job_id": "j1", "stage": "done", "pack": {"pack_id": "phantom_road_mesh.kyiv"}}


async def test_rest_derives_the_pack_path_the_glass_composes_with(auth_root_client):
    _install(auth_root_client, _Service(running=dict(_DONE)))
    pack = auth_root_client.get("/api/v1/bake/jobs/current").json()["job"]["pack"]
    assert pack["filename"] == "phantom_road_mesh.kyiv.db"
    assert pack["rel_path"] == "road/phantom_road_mesh.kyiv.db"


async def test_the_ws_frame_carries_no_path_not_even_a_relative_one(spy_hub):
    """Асиметрія навмисна: телефон бачить пакет, але не бачить, ДЕ він."""
    await BakeBroadcaster()("job.finished", dict(_DONE))
    pack = spy_hub.frames[0]["pack"]
    assert "rel_path" not in pack and "filename" not in pack
    assert pack["pack_id"] == "phantom_road_mesh.kyiv", "а pack_id мусить доїхати"


async def test_a_dead_ws_hub_never_kills_the_bake(monkeypatch):
    """Випікання триває хвилини; впасти через те, що ніхто не слухає, — абсурд."""
    import api.websocket_hub as mod

    class _Dead:
        async def broadcast(self, *_a, **_kw):
            raise RuntimeError("hub down")

    monkeypatch.setattr(mod, "hub", _Dead())
    await BakeBroadcaster()("job.started", {"stage": "preflight"})
