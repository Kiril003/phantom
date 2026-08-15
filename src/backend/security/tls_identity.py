"""Власний сертифікат вузла + його відбиток для QR.

Паринг і все, що по ньому тече — сенсори, картки сховища, натискання
клавіш — ішли відкритим HTTP. У локальній мережі це вже погано, а з
виходом у світову — неприпустимо.

Публічного імені в цього вузла немає, тож Let's Encrypt не застосуєш.
Натомість беремо те, що вже закладено в протокол: у QR є поле
`server_cert_sha256`, а телефон уміє прибивати з'єднання до відбитка
(`isDevNoPin` у PairingQr.kt). Самопідписаний сертифікат + прибитий
відбиток дає шифрування й автентичність сервера без жодного центру
сертифікації — і без єдиного питання до оператора.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import ipaddress
import logging
import socket
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_CERT_NAME = "node-cert.pem"
_KEY_NAME = "node-key.pem"
_VALID_DAYS = 825


def tls_dir() -> Path:
    from paths import resolve_data_dir

    return resolve_data_dir("tls")


def cert_path() -> Path:
    return tls_dir() / _CERT_NAME


def key_path() -> Path:
    return tls_dir() / _KEY_NAME


def _san_entries(extra_ips: list[str]) -> tuple[list[str], list[str]]:
    names = {"localhost", "phantom.local", socket.gethostname()}
    ips = {"127.0.0.1"}
    for raw in extra_ips:
        raw = (raw or "").strip()
        if not raw:
            continue
        try:
            ipaddress.ip_address(raw)
            ips.add(raw)
        except ValueError:
            names.add(raw)
    return sorted(names), sorted(ips)


def ensure_node_cert(extra_ips: Optional[list[str]] = None) -> tuple[Path, Path]:
    """Створити сертифікат вузла, якщо його ще немає. Ключ — 0600."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    directory = tls_dir()
    directory.mkdir(parents=True, exist_ok=True)
    cert, key = cert_path(), key_path()
    if cert.is_file() and key.is_file():
        return cert, key

    names, ips = _san_entries(extra_ips or [])
    private_key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "PHANTOM node"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "PHANTOM OS"),
    ])
    now = _dt.datetime.now(_dt.timezone.utc)
    san = x509.SubjectAlternativeName(
        [x509.DNSName(n) for n in names]
        + [x509.IPAddress(ipaddress.ip_address(i)) for i in ips]
    )
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - _dt.timedelta(minutes=5))
        .not_valid_after(now + _dt.timedelta(days=_VALID_DAYS))
        .add_extension(san, critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(private_key, hashes.SHA256())
    )

    key.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    key.chmod(0o600)
    cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    logger.info("TLS: сертифікат вузла створено (%s, %s)", names, ips)
    return cert, key


def cert_fingerprint_sha256() -> str:
    """Відбиток DER-сертифіката у нижньому регістрі без роздільників."""
    from cryptography import x509

    path = cert_path()
    if not path.is_file():
        return ""
    der = x509.load_pem_x509_certificate(path.read_bytes()).public_bytes(
        __import__("cryptography").hazmat.primitives.serialization.Encoding.DER
    )
    return hashlib.sha256(der).hexdigest()


__all__ = [
    "ensure_node_cert",
    "cert_fingerprint_sha256",
    "cert_path",
    "key_path",
]
