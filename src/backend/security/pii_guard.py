"""Phase 35/36 — Cognitive Immunity PII Pre-write Guard.
Detects credit card numbers, private keys, and high-entropy credentials (passwords/API keys) in user input
and encrypts them into the Vault (VaultCard) using AES-256-GCM (vault_crypto), replacing them with redaction tokens.
"""
from __future__ import annotations
import re
import math
import uuid
import json
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import VaultCard
from security.vault_crypto import encrypt_field

logger = logging.getLogger(__name__)

# Regexes for secrets
_CARD_CANDIDATE_RE = re.compile(r"\b[3-6][0-9](?:[ -]?[0-9]){11,17}\b")
_STRICT_CARD_RE = re.compile(r"^(?:4[0-9]{12}(?:[0-9]{3})?|[52][1-5][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13})$")
_PRIVATE_KEY_RE = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*[a-zA-Z0-9\s+/=\\]+?\s*-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", re.MULTILINE)
_API_KEY_RE = re.compile(r"(?:api_key|password|secret|passwd|token|private_key)\s*[:=]\s*['\"]([a-zA-Z0-9_-]{16,64})['\"]", re.IGNORECASE)


def _entropy(s: str) -> float:
    """Calculate Shannon entropy to distinguish actual high-entropy secrets from common strings."""
    if not s:
        return 0.0
    entropy = 0.0
    for x in range(256):
        p_x = float(s.count(chr(x))) / len(s)
        if p_x > 0:
            entropy += - p_x * math.log(p_x, 2)
    return entropy


def _luhn_check(num: str) -> bool:
    """Luhn algorithm validation to prevent false positives on random 13-16 digit numbers."""
    num = num.replace("-", "").replace(" ", "")
    if not num.isdigit():
        return False
    digits = [int(x) for x in num]
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    checksum = sum(odd_digits)
    for d in even_digits:
        checksum += sum(divmod(d * 2, 10))
    return checksum % 10 == 0


async def pii_guard(db: AsyncSession, user_id: str, text: str) -> str:
    """Detects secrets, stores them securely in the Vault, and replaces them with ⟦vault:card_id:field⟧ tokens.

    Ensures that plain credentials never hit chat episodes or ChromaDB vector embeddings.
    """
    modified = False

    # 1. Check Credit Cards
    for match in _CARD_CANDIDATE_RE.finditer(text):
        candidate = match.group(0)
        cleaned = candidate.replace(" ", "").replace("-", "")
        if _STRICT_CARD_RE.match(cleaned) and _luhn_check(cleaned):
            card_id = str(uuid.uuid4())
            try:
                token = encrypt_field(
                    user_id=user_id,
                    card_id=card_id,
                    field_name="number",
                    plaintext=cleaned
                )
                card = VaultCard(
                    id=card_id,
                    owner_user_id=user_id,
                    kind="payment_method",
                    label="Auto-vaulted Credit Card",
                    fields_json=json.dumps({"number": {"v": token, "secret": True}}),
                    tags_json=json.dumps(["auto-vaulted", "pii-guard"]),
                    ai_writable=True,
                    created_at=datetime.now(tz=timezone.utc),
                    updated_at=datetime.now(tz=timezone.utc)
                )
                db.add(card)
                text = text.replace(candidate, f"⟦vault:{card_id}:number⟧")
                modified = True
                logger.info("PII Guard auto-vaulted credit card %s", card_id)
            except Exception as e:
                logger.error("PII Guard failed to encrypt credit card: %s", e)

    # 2. Check Private Keys
    for match in _PRIVATE_KEY_RE.finditer(text):
        pkey = match.group(0)
        card_id = str(uuid.uuid4())
        try:
            token = encrypt_field(
                user_id=user_id,
                card_id=card_id,
                field_name="private_key",
                plaintext=pkey
            )
            card = VaultCard(
                id=card_id,
                owner_user_id=user_id,
                kind="crypto_wallet",
                label="Auto-vaulted Private Key",
                fields_json=json.dumps({"private_key": {"v": token, "secret": True}}),
                tags_json=json.dumps(["auto-vaulted", "pii-guard"]),
                ai_writable=True,
                created_at=datetime.now(tz=timezone.utc),
                updated_at=datetime.now(tz=timezone.utc)
            )
            db.add(card)
            text = text.replace(pkey, f"⟦vault:{card_id}:private_key⟧")
            modified = True
            logger.info("PII Guard auto-vaulted private key %s", card_id)
        except Exception as e:
            logger.error("PII Guard failed to encrypt private key: %s", e)

    # 3. Check High-entropy credentials (passwords/API keys)
    for match in _API_KEY_RE.finditer(text):
        secret_val = match.group(1)
        if _entropy(secret_val) > 3.0 and len(secret_val) >= 16:
            card_id = str(uuid.uuid4())
            try:
                token = encrypt_field(
                    user_id=user_id,
                    card_id=card_id,
                    field_name="credential",
                    plaintext=secret_val
                )
                card = VaultCard(
                    id=card_id,
                    owner_user_id=user_id,
                    kind="api_key",
                    label="Auto-vaulted API Key / Secret",
                    fields_json=json.dumps({"credential": {"v": token, "secret": True}}),
                    tags_json=json.dumps(["auto-vaulted", "pii-guard"]),
                    ai_writable=True,
                    created_at=datetime.now(tz=timezone.utc),
                    updated_at=datetime.now(tz=timezone.utc)
                )
                db.add(card)
                text = text.replace(secret_val, f"⟦vault:{card_id}:credential⟧")
                modified = True
                logger.info("PII Guard auto-vaulted high-entropy credential %s", card_id)
            except Exception as e:
                logger.error("PII Guard failed to encrypt credential: %s", e)

    if modified:
        await db.flush()

    return text
