"""TURN-ретранслятор для дзвінків: конфіг у даних вузла, ключі — ефемерні.

Чому конфіг у ДАНИХ, а не в коді: адреса й секрет ретранслятора належать
конкретному вузлу, а не збірці. Один власник поставив свій coturn, інший
користується чужим, третій не має жодного — і всі троє мають однаковий
бінарник. Немає `turn.json` — немає TURN, і вузол каже це прямо.

Чому креденшели ефемерні: секрет coturn (`use-auth-secret`) не має права
покидати вузол. Замість нього браузер отримує пару, яка живе годину —
username це просто час її смерті, а пароль виводиться з секрету через
HMAC-SHA1. Коли година мине, пара стане сміттям, і те, що вона колись
протекла в лог браузера, нікому не дасть ретранслятора.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from paths import data_root

logger = logging.getLogger(__name__)

#: STUN лише повідомляє браузеру його зовнішню адресу. Він безкоштовний,
#: публічний і не возить медіа — тож стоїть у відповіді завжди.
STUN_URL = "stun:stun.l.google.com:19302"

#: Година — стандарт для coturn: достатньо на найдовший дзвінок і достатньо
#: мало, щоб протекла пара не була вічною.
DEFAULT_TTL_S = 3600


@dataclass(frozen=True)
class TurnConfig:
    host: str
    port: int
    secret: str
    ttl_s: int = DEFAULT_TTL_S


def turn_config_path() -> Path:
    return data_root() / "turn.json"


def load_turn_config(path: Optional[Path] = None) -> Optional[TurnConfig]:
    """Читає `turn.json`. None означає «ретранслятора немає», а не помилку."""
    file = path or turn_config_path()
    try:
        raw = json.loads(file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        # Зіпсований файл — це той самий «немає TURN», але про нього треба
        # сказати вголос: мовчазне падіння в STUN виглядало б як норма.
        logger.warning("turn.json не читається (%s) — працюємо без ретранслятора", exc)
        return None
    if not isinstance(raw, dict):
        return None

    host = str(raw.get("host") or "").strip()
    secret = str(raw.get("secret") or "").strip()
    if not host or not secret:
        logger.warning("turn.json без host або secret — працюємо без ретранслятора")
        return None
    try:
        port = int(raw.get("port") or 3478)
        ttl = int(raw.get("ttl") or DEFAULT_TTL_S)
    except (TypeError, ValueError):
        logger.warning("turn.json із неправильним port/ttl — працюємо без ретранслятора")
        return None
    # Пара, яка вмирає раніше, ніж браузер устигне зібрати кандидатів, гірша
    # за її відсутність: дзвінок падав би вже після «зʼєднуємось».
    return TurnConfig(host=host, port=port, secret=secret, ttl_s=max(60, ttl))


def ephemeral_credentials(cfg: TurnConfig, now: Optional[int] = None) -> tuple[str, str]:
    """Пара coturn `use-auth-secret`: username — час смерті, пароль — HMAC від нього."""
    username = str(int(now if now is not None else time.time()) + cfg.ttl_s)
    credential = base64.b64encode(
        hmac.new(cfg.secret.encode(), username.encode(), hashlib.sha1).digest()
    ).decode()
    return username, credential


def ice_payload(cfg: Optional[TurnConfig], now: Optional[int] = None) -> dict[str, Any]:
    """Те, що бачить браузер. Секрет сюди не потрапляє за побудовою."""
    servers: list[dict[str, Any]] = [{"urls": [STUN_URL]}]
    if cfg is None:
        return {"iceServers": servers, "turn": False, "ttl": 0}

    username, credential = ephemeral_credentials(cfg, now)
    # UDP і TCP окремими рядками: там, де вихідний UDP зарізаний файрволом,
    # лишається TCP на тому ж порту — це ті самі 3478.
    servers.append(
        {
            "urls": [
                f"turn:{cfg.host}:{cfg.port}?transport=udp",
                f"turn:{cfg.host}:{cfg.port}?transport=tcp",
            ],
            "username": username,
            "credential": credential,
        }
    )
    return {"iceServers": servers, "turn": True, "ttl": cfg.ttl_s}
