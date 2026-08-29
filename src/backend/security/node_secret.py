"""Секрет підпису токенів належить ВУЗЛУ, а не збірці.

Знахідка панелі раунду 4: усі вузли стенда підіймаються з одного checkout,
а `JWT_SECRET_KEY` лежить у `src/backend/.env` — тобто в коді, а не в даних.
Наслідок: токен, підписаний вузлом B, валідний на вузлі A. Компрометація
одного вузла (або одного бекапу репозиторію) віддає сесії на всіх.

Тому секрет підпису переїжджає в дані вузла — так само, як `turn.json`:
файл `token_secret.key` у `data_root()`, права 600, генерується при першому
старті. Два вузли з різними `PHANTOM_DATA_DIR` отримують різні секрети
автоматично, без жодної ручної роботи оператора.

Що НЕ переїхало і чому: `security/crypto.py` (Fernet для PII) і
`security/vault_crypto.py` (ключі сейфа) далі виводять свої ключі з
`config.jwt_secret_key`. Це навмисно — вони шифрують дані НА ДИСКУ, і зміна
їхнього кореня зробила б уже записану базу нечитаною. Тут ідеться лише про
підпис ефемерних токенів, які й так живуть годинами.

Порядок вибору (перше, що спрацювало):

1. ``PHANTOM_TOKEN_SECRET_SHARED=1`` — оператор свідомо хоче спільний на
   флот секрет (єдиний вхід за кількома вузлами за балансувальником).
   Береться ``config.jwt_secret_key`` як є.
2. ``JWT_SECRET_KEY`` у середовищі ПРОЦЕСУ — явна воля того, хто запускав
   саме цей процес (docker-compose, systemd unit, pytest). Шануємо.
3. ``<data_root>/token_secret.key`` — свій на вузол, створюється тут.
4. ``config.jwt_secret_key`` із `.env` — лише коли теку даних не вдалося
   записати. Це той самий спільний секрет, тож про нього кажемо вголос.
"""
from __future__ import annotations

import logging
import os
import secrets
import stat
from pathlib import Path
from typing import Optional

from config import config
from paths import data_root

logger = logging.getLogger(__name__)

SECRET_FILE_NAME = "token_secret.key"

#: 48 байт ентропії у base64url — 64 символи, вдвічі більше за поріг HS256.
_SECRET_BYTES = 48

_cached: Optional[str] = None
_warned_shared = False


def token_secret_path() -> Path:
    return data_root() / SECRET_FILE_NAME


def reset_cache() -> None:
    """Скидає памʼять про секрет. Потрібно тестам і перевипуску токенів."""
    global _cached, _warned_shared
    _cached = None
    _warned_shared = False


def token_signing_secret() -> str:
    """Секрет, яким цей вузол підписує й перевіряє свої токени."""
    global _cached
    if _cached is not None:
        return _cached
    _cached = _resolve()
    return _cached


def _resolve() -> str:
    if os.environ.get("PHANTOM_TOKEN_SECRET_SHARED") == "1":
        if not config.jwt_secret_key:
            raise RuntimeError(
                "PHANTOM_TOKEN_SECRET_SHARED=1 але JWT_SECRET_KEY порожній — "
                "нема чим підписувати токени."
            )
        logger.warning(
            "PHANTOM_TOKEN_SECRET_SHARED=1 — токени підписуються спільним "
            "секретом. Токен, украдений на одному вузлі, відкриє решту."
        )
        return config.jwt_secret_key

    env_secret = os.environ.get("JWT_SECRET_KEY")
    if env_secret:
        return env_secret

    file_secret = _load_or_create_file_secret()
    if file_secret:
        return file_secret

    if config.jwt_secret_key:
        logger.warning(
            "Не вдалося створити %s — підписуємо токени секретом із .env. "
            "Він спільний для всіх вузлів цього checkout.",
            token_secret_path(),
        )
        return config.jwt_secret_key

    raise RuntimeError(
        "Немає секрету для підпису токенів: тека даних недоступна для запису, "
        "JWT_SECRET_KEY теж не заданий."
    )


def _load_or_create_file_secret() -> Optional[str]:
    path = token_secret_path()
    try:
        existing = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        existing = ""
    except OSError as exc:
        logger.warning("не читається %s (%s)", path, exc)
        return None

    if existing:
        _warn_if_world_readable(path)
        return existing

    return _create_file_secret(path)


def _create_file_secret(path: Path) -> Optional[str]:
    secret = secrets.token_urlsafe(_SECRET_BYTES)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Створюємо одразу з правами 600: між `write_text` і `chmod` є вікно,
        # у якому секрет лежав би читабельним для всієї машини.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, secret.encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(tmp, path)
    except OSError as exc:
        logger.warning("не вдалося записати %s (%s)", path, exc)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return None

    logger.info(
        "згенеровано власний секрет підпису токенів: %s (600). Токени, "
        "видані іншим вузлом, на цьому вузлі більше не діють.",
        path,
    )
    return secret


def _warn_if_world_readable(path: Path) -> None:
    try:
        mode = path.stat().st_mode
    except OSError:
        return
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        logger.warning(
            "%s доступний не тільки власнику (%o) — виправте на 600",
            path,
            stat.S_IMODE(mode),
        )


__all__ = [
    "SECRET_FILE_NAME",
    "reset_cache",
    "token_secret_path",
    "token_signing_secret",
]
