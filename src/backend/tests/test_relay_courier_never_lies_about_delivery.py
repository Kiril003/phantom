"""Чи каже дорога до сховка правду про те, що сталося з листом.

Клас дефектів №1 у цьому домі — «мовчки нічого не робить»: функція повертає
успіх або None, викликач вважає, що доїхало, і ніхто не бачить, що не доїхало
ніколи. Сховок — рівно те місце, де це коштувало б найдорожче: лист лежить у
черзі, вузол «відправив», адресат не отримав, і жоден лог про це не скаже.

Тому тут перевіряється не «повернуло щось», а що КОЖЕН стан сервера доїжджає
до викликача під власним іменем: лежить / зачекай / місця нема / контракт
порушено / дороги нема. І окремо — що клієнт не витрачає запит із ліміту
120/хв на конверт, який завідомо буде відхилений.

Стаб нижче повторює правила справжнього сервера (platform-site/server/relay.py
та main.py:1775–1880), а не імітує «щось на 200»: рівно три довжини конверта,
рівно 64 різні адреси, форма адреси, і ті самі коди 400/429/507.
"""
from __future__ import annotations

import base64
import uuid

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from node import peer_relay as pr
from node.relay_courier import (
    Burned,
    Busy,
    Fetched,
    Full,
    Held,
    Offline,
    Refused,
    RelayCourier,
)

PAIR_KEY = bytes(range(32))
A, B = "node-a", "node-b"


# ── Стаб сховка з тими самими правилами ──────────────────────────────────────


class _Drop(BaseModel):
    tag: str
    blob: str


class _Fetch(BaseModel):
    tags: list[str]


class _Burn(BaseModel):
    ids: list[str]


def build_stub(*, always: str | None = None) -> FastAPI:
    """`always` вмикає режим, у якому сервер завжди відповідає одним станом —
    так перевіряються 429 і 507, які інакше довелось би відтворювати
    навантаженням."""
    app = FastAPI()
    store: dict[str, list[dict]] = {}

    def _gate() -> None:
        if always == "busy":
            raise HTTPException(429, "Забагато запитів / too many requests")
        if always == "full":
            raise HTTPException(507, "Сховок повний / relay is full")
        if always == "boom":
            raise HTTPException(503, "no")

    @app.post("/relay/drop")
    def drop(body: _Drop):
        _gate()
        if not pr.is_tag(body.tag):
            raise HTTPException(400, "Адреса скриньки не тієї форми")
        raw = base64.b64decode(body.blob)
        if len(raw) not in pr.BLOB_SIZES:
            raise HTTPException(400, "Довжина конверта не з переліку")
        row = {"id": uuid.uuid4().hex, "tag": body.tag, "blob": raw}
        store.setdefault(body.tag, []).append(row)
        return {"held_until": "2026-09-05T00:00:00+00:00"}

    @app.post("/relay/fetch")
    def fetch(body: _Fetch):
        _gate()
        if len(body.tags) != pr.FETCH_TAGS or len(set(body.tags)) != pr.FETCH_TAGS:
            raise HTTPException(400, "Потрібно рівно 64 різних адрес")
        if not all(pr.is_tag(t) for t in body.tags):
            raise HTTPException(400, "Адреса скриньки не тієї форми")
        out = []
        for tag in body.tags:
            for row in store.get(tag, []):
                out.append(
                    {"id": row["id"], "tag": row["tag"], "blob": base64.b64encode(row["blob"]).decode()}
                )
        return {"blobs": out}

    @app.post("/relay/burn")
    def burn(body: _Burn):
        _gate()
        if not body.ids:
            raise HTTPException(400, "Нічого палити")
        wanted, burned = set(body.ids), 0
        for tag, rows in list(store.items()):
            keep = [r for r in rows if r["id"] not in wanted]
            burned += len(rows) - len(keep)
            store[tag] = keep
        return {"burned": burned}

    return app


def courier_for(app: FastAPI) -> RelayCourier:
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://stub")
    return RelayCourier("http://stub", client=client)


@pytest.fixture
def key():
    return pr.relay_key(PAIR_KEY, A, B)


@pytest.fixture
def tag(key):
    return pr.msg_tag(key, A, B, 20_000)


@pytest.fixture
def sixty_four(tag):
    """Рівно 64 різні адреси, серед них наша."""
    return [tag] + pr.decoy_tags(pr.FETCH_TAGS - 1)


# ── Повний цикл ──────────────────────────────────────────────────────────────


async def test_a_letter_goes_in_comes_back_and_burns(key, tag, sixty_four):
    """Той самий цикл, що я проганяв проти прода — тільки тут він у тестах."""
    courier = courier_for(build_stub())
    wrapped = pr.wrap("слово, і кома", key, tag)

    dropped = await courier.drop(tag, wrapped.blob)
    assert isinstance(dropped, Held) and dropped.held_until

    got = await courier.fetch(sixty_four)
    assert isinstance(got, Fetched)
    assert len(got.letters) == 1
    # Головне: конверт доїхав байт-у-байт і відкривається тим самим ключем.
    assert got.letters[0].blob == wrapped.blob
    assert pr.unwrap(got.letters[0].blob, key, tag) == "слово, і кома"

    burned = await courier.burn([letter.id for letter in got.letters])
    assert isinstance(burned, Burned) and burned.count == 1

    after = await courier.fetch(sixty_four)
    assert isinstance(after, Fetched) and after.letters == []


# ── Кожен стан сервера має власне ім'я ───────────────────────────────────────


async def test_rate_limit_arrives_as_busy_not_as_failure(key, tag):
    """429 — це правило, не поломка: чекати й повторити, а не скидати лист."""
    courier = courier_for(build_stub(always="busy"))
    wrapped = pr.wrap("лист", key, tag)
    outcome = await courier.drop(tag, wrapped.blob)
    assert isinstance(outcome, Busy)
    assert outcome.retry_after_s > 0


async def test_a_full_store_is_its_own_state(key, tag):
    """507 не можна плутати з мережевою відмовою: сервер працює, місця нема,
    і чужий лист заради нашого він не витирає."""
    courier = courier_for(build_stub(always="full"))
    wrapped = pr.wrap("лист", key, tag)
    assert isinstance(await courier.drop(tag, wrapped.blob), Full)


async def test_server_error_reads_as_offline_not_as_our_fault(key, tag):
    courier = courier_for(build_stub(always="boom"))
    wrapped = pr.wrap("лист", key, tag)
    outcome = await courier.drop(tag, wrapped.blob)
    assert isinstance(outcome, Offline)
    assert "503" in outcome.reason


async def test_unreachable_store_does_not_look_like_delivery():
    """Найдорожча брехня: «доїхало», коли мережі не було."""
    courier = RelayCourier("http://127.0.0.1:9")  # порт-глушник
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    outcome = await courier.drop(tag, pr.wrap("лист", key, tag).blob)
    assert isinstance(outcome, Offline)


async def test_no_address_configured_is_offline_not_a_crash():
    courier = RelayCourier("")
    assert not courier.configured
    key = pr.relay_key(PAIR_KEY, A, B)
    tag = pr.msg_tag(key, A, B, 20_000)
    assert isinstance(await courier.drop(tag, pr.wrap("л", key, tag).blob), Offline)


# ── Контракт стережеться ДО мережі ───────────────────────────────────────────


async def test_a_wrong_sized_envelope_never_reaches_the_wire(key, tag):
    """400 коштує запиту з ліміту 120/хв, а причина — наша. Тож ловимо вдома."""
    courier = courier_for(build_stub())
    outcome = await courier.drop(tag, b"\x00" * 5_000)
    assert isinstance(outcome, Refused)
    assert "5000" in outcome.detail


async def test_a_malformed_tag_never_reaches_the_wire(key):
    courier = courier_for(build_stub())
    blob = b"\x00" * pr.BLOB_SIZES[0]
    outcome = await courier.drop("надто-коротка", blob)
    assert isinstance(outcome, Refused)


@pytest.mark.parametrize(
    "tags, why",
    [
        (lambda t: [t] + pr.decoy_tags(62), "63 адреси"),
        (lambda t: [t] * 64, "64 однакові"),
        (lambda t: [t] + pr.decoy_tags(64), "65 адрес"),
    ],
)
async def test_a_fetch_of_the_wrong_width_is_refused_at_home(tag, tags, why):
    """Ширина вибірки — це анонімність. Інша ширина сказала б серверові,
    скільки співрозмовників має цей вузол; сервер її й не прийме."""
    courier = courier_for(build_stub())
    outcome = await courier.fetch(tags(tag))
    assert isinstance(outcome, Refused), why


async def test_burning_nothing_is_not_an_error():
    """Порожній список сервер відхилив би 400. Це не стан помилки — просто
    нема чого палити, і викликач не має розрізняти ці два випадки сам."""
    courier = courier_for(build_stub())
    outcome = await courier.burn([])
    assert isinstance(outcome, Burned) and outcome.count == 0


# ── Стійкість до сміття з мережі ─────────────────────────────────────────────


async def test_one_corrupt_envelope_does_not_lose_the_others(key, tag, sixty_four, monkeypatch):
    """Захід за листами не має гинути через один зіпсований конверт: решта в
    тій самій відповіді доїхала чесно."""
    app = build_stub()
    courier = courier_for(app)
    wrapped = pr.wrap("цілий", key, tag)
    await courier.drop(tag, wrapped.blob)

    real_post = courier._post

    async def poisoned(path, body):
        result = await real_post(path, body)
        if path == "/relay/fetch" and isinstance(result, dict):
            result["blobs"].insert(0, {"id": "битий", "tag": tag, "blob": "не-base64!!"})
        return result

    monkeypatch.setattr(courier, "_post", poisoned)
    got = await courier.fetch(sixty_four)
    assert isinstance(got, Fetched)
    assert len(got.letters) == 1
    assert pr.unwrap(got.letters[0].blob, key, tag) == "цілий"
