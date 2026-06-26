"""
Phase 24-N — GHOST Recorder.
Encrypted append-only log for GHOST state activities.
"""
import os
import time
import json
import logging
from typing import Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

logger = logging.getLogger(__name__)

class GhostRecorder:
    def __init__(self, key: str, data_dir: str):
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
        
        # Derive AES-256-GCM key from user provided key (RFID UID or similar)
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'PHANTOM_GHOST_v1',
            iterations=100000,
        )
        self.aes_key = kdf.derive(key.encode())
        self.log_file = os.path.join(self.data_dir, f"ghost_{int(time.time())}.enc")

    def record(self, event_type: str, data: dict):
        """Encrypt and append an event to the ghost log."""
        aesgcm = AESGCM(self.aes_key)
        nonce = os.urandom(12)
        
        payload = json.dumps({
            "ts": time.time(),
            "type": event_type,
            "payload": data
        }).encode()
        
        ciphertext = aesgcm.encrypt(nonce, payload, None)
        
        # Format: [nonce (12 bytes)][ciphertext]
        with open(self.log_file, "ab") as f:
            f.write(nonce + ciphertext + b"\n")
            
    def list_logs(self) -> list[str]:
        return [f for f in os.listdir(self.data_dir) if f.startswith("ghost_") and f.endswith(".enc")]
