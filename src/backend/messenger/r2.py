"""R2 — дорога для шифроблобів, коли вузол адресата мовчить.

Кадр має чотири дороги, а вкладення досі мало одну: пряму адресу. Немає її —
файл лежав queued вічно, бо ретранслятор возить кадри, а не байти. Тут третя
сторона тримає шифротекст рівно доти, доки адресат його не забере.

Хмара бачить непрозорі байти й нічого більше: файл шифрує браузер відправника
(AES-256-GCM), ключ їде в тілі повідомлення наскрізним кадром. Імʼя обʼєкта —
`<node_id адресата>/<blob_id>`, тобто два випадкові рядки без натяку на вміст.

Дорога вмикається ЛИШЕ з env: немає всіх чотирьох значень — немає й дороги,
і вузол чесно лишає блоб у черзі замість вдавати доставку. Жодних типових
значень тут немає навмисно: ключ, вписаний «про запас», — це чужий бакет,
куди вузол мовчки понесе байти власника.

Підпис SigV4 зроблено руками на httpx, який у залежностях і так є: boto3
тягне за собою botocore з половиною AWS заради трьох запитів PUT/GET/DELETE.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

__all__ = [
    "PARK_MAX_BYTES",
    "R2Road",
    "canonical_request",
    "drop_object",
    "fetch_object",
    "object_key",
    "park_object",
    "r2_road",
    "sigv4_authorization",
]

_ALGORITHM = "AWS4-HMAC-SHA256"
#: R2 не має регіонів, але S3-підпис вимагає рядка. `auto` — той, який
#: Cloudflare приймає й сам же радить у своїй документації.
R2_REGION = "auto"
_SERVICE = "s3"
#: Блоб може важити 25 МБ, і на мобільному висхідному каналі це хвилини.
_TIMEOUT_S = 120.0

#: Стеля припаркованого блоба — та сама, що й у приймальні вузла
#: (`blobs.BLOB_LIMIT_BYTES`). Тест звіряє їх, щоб не розʼїхались мовчки.
PARK_MAX_BYTES = 25 * 1024 * 1024

_BLOB_ID_RE = re.compile(r"^[0-9a-f]{32,64}$")
_NODE_ID_RE = re.compile(r"^[0-9a-zA-Z_-]{8,64}$")


@dataclass(frozen=True)
class R2Road:
    """Чотири значення, без яких дороги немає."""

    endpoint: str
    bucket: str
    access_key: str
    secret_key: str


def r2_road(config: Any) -> Optional[R2Road]:
    """Дорога з конфігурації; None — дороги немає, і це нормальний стан."""
    endpoint = (getattr(config, "r2_endpoint", "") or "").strip()
    bucket = (getattr(config, "r2_bucket", "") or "").strip()
    access = (getattr(config, "r2_access_key", "") or "").strip()
    secret = (getattr(config, "r2_secret_key", "") or "").strip()
    if endpoint and bucket and access and secret:
        return R2Road(endpoint=endpoint, bucket=bucket, access_key=access, secret_key=secret)
    return None


def object_key(recipient_node_id: str, blob_id: str) -> str:
    """`<node_id>/<blob_id>` — і обидва перевірені.

    Обидва рядки приходять із бази, але лягають у шлях HTTP-запиту, тож
    перевірка стоїть тут, а не в кожному викликачі: `../` в імені обʼєкта
    вивів би запит за межі бакета.
    """
    node = (recipient_node_id or "").strip()
    if not _NODE_ID_RE.match(node):
        raise ValueError("непридатний node_id адресата")
    if not _BLOB_ID_RE.match(blob_id or ""):
        raise ValueError("непридатний ідентифікатор блоба")
    return f"{node}/{blob_id}"


# ── Підпис ───────────────────────────────────────────────────────────────────


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def canonical_request(
    method: str,
    uri: str,
    query: str,
    headers: Mapping[str, str],
    payload_hash: str,
) -> tuple[str, str]:
    """Канонічний запит і перелік підписаних заголовків."""
    lowered = {
        str(name).lower().strip(): " ".join(str(value).split())
        for name, value in headers.items()
    }
    names = sorted(lowered)
    joined = "".join(f"{name}:{lowered[name]}\n" for name in names)
    signed = ";".join(names)
    return (
        "\n".join([method.upper(), uri, query, joined, signed, payload_hash]),
        signed,
    )


def sigv4_authorization(
    *,
    method: str,
    uri: str,
    query: str = "",
    headers: Mapping[str, str],
    payload_hash: str,
    access_key: str,
    secret_key: str,
    amz_date: str,
    region: str = R2_REGION,
    service: str = _SERVICE,
) -> str:
    """Значення заголовка Authorization за AWS Signature Version 4.

    Функція навмисно чиста й приймає заголовки як є: так її можна прогнати
    проти опублікованого вектора AWS і побачити збіг байт у байт, а не
    вірити, що «ну сервер же прийняв».
    """
    creq, signed = canonical_request(method, uri, query, headers, payload_hash)
    scope = f"{amz_date[:8]}/{region}/{service}/aws4_request"
    to_sign = "\n".join([_ALGORITHM, amz_date, scope, _sha256_hex(creq.encode())])
    key = _sign(f"AWS4{secret_key}".encode(), amz_date[:8])
    key = _sign(key, region)
    key = _sign(key, service)
    key = _sign(key, "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    return (
        f"{_ALGORITHM} Credential={access_key}/{scope}, "
        f"SignedHeaders={signed}, Signature={signature}"
    )


def _endpoint_url(endpoint: str) -> httpx.URL:
    raw = (endpoint or "").strip().rstrip("/")
    if not raw:
        raise ValueError("порожня адреса R2")
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    return httpx.URL(raw)


def _request(
    road: R2Road, method: str, key: str, payload: bytes, *, now: Optional[datetime] = None
) -> tuple[str, dict[str, str]]:
    """Готує (url, headers) з підписом. Тіло потрібне лише для його відбитка."""
    base = _endpoint_url(road.endpoint)
    path = "/" + "/".join(
        quote(part, safe="") for part in [road.bucket, *key.split("/")] if part
    )
    host = base.netloc.decode()
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    amz_date = moment.strftime("%Y%m%dT%H%M%SZ")
    payload_hash = _sha256_hex(payload)
    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    headers["Authorization"] = sigv4_authorization(
        method=method,
        uri=path,
        headers=headers,
        payload_hash=payload_hash,
        access_key=road.access_key,
        secret_key=road.secret_key,
        amz_date=amz_date,
    )
    return f"{base.scheme}://{host}{path}", headers


# ── Три дії, і жодного «майже» ───────────────────────────────────────────────


async def park_object(
    road: R2Road,
    key: str,
    data: bytes,
    *,
    client: Optional[httpx.AsyncClient] = None,
) -> bool:
    """Кладе шифротекст у бакет. True лише коли хмара підтвердила запис."""
    if not data:
        return False
    if len(data) > PARK_MAX_BYTES:
        logger.info("блоб завеликий для хмарної дороги: %d", len(data))
        return False
    try:
        url, headers = _request(road, "PUT", key, data)
    except ValueError as exc:
        logger.info("хмарна дорога не склалась: %s", exc)
        return False

    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.put(
            url,
            content=data,
            headers={**headers, "Content-Type": "application/octet-stream"},
        )
        if response.status_code in (200, 201, 204):
            return True
        logger.info("хмара не взяла блоб: %s", response.status_code)
        return False
    except Exception as exc:  # noqa: BLE001 — мережа падає як завгодно
        logger.info("до хмари не достукались: %s", type(exc).__name__)
        return False
    finally:
        if own:
            await http.aclose()


async def fetch_object(
    road: R2Road, key: str, *, client: Optional[httpx.AsyncClient] = None
) -> Optional[bytes]:
    """Забирає шифротекст із бакета. None — його там немає або хмара мовчить."""
    try:
        url, headers = _request(road, "GET", key, b"")
    except ValueError as exc:
        logger.info("хмарна дорога не склалась: %s", exc)
        return None

    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.get(url, headers=headers)
        if response.status_code == 200:
            data = response.content
            if len(data) > PARK_MAX_BYTES:
                logger.info("з хмари приїхало більше за стелю: %d", len(data))
                return None
            return data
        if response.status_code != 404:
            logger.info("хмара не віддала блоб: %s", response.status_code)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.info("до хмари не достукались: %s", type(exc).__name__)
        return None
    finally:
        if own:
            await http.aclose()


async def drop_object(
    road: R2Road, key: str, *, client: Optional[httpx.AsyncClient] = None
) -> bool:
    """Прибирає забраний обʼєкт. Невдача — не помилка: байти вже в адресата.

    Прибирання тут не з ввічливості: у безкоштовному R2 місце скінченне, а
    блоб, який уже лежить на диску одержувача, у хмарі не потрібен нікому.
    """
    try:
        url, headers = _request(road, "DELETE", key, b"")
    except ValueError:
        return False

    own = client is None
    http = client or httpx.AsyncClient(timeout=_TIMEOUT_S)
    try:
        response = await http.delete(url, headers=headers)
        if response.status_code in (200, 202, 204, 404):
            return True
        logger.info("хмара не прибрала обʼєкт: %s", response.status_code)
        return False
    except Exception as exc:  # noqa: BLE001
        logger.info("прибирання в хмарі не вдалось: %s", type(exc).__name__)
        return False
    finally:
        if own:
            await http.aclose()
