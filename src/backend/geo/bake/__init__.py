"""Випікання дорожніх пакетів усередині продукту, а не в чужому скрипті.

`worker` навмисно НЕ реекспортується: він живе в окремому процесі, і кожен
його імпорт сюди тягнув би osmium у памʼять сервера — того самого, що першим
стоїть у списку демона oom-guard.
"""
from .contract import JobStatus, Outcome, PackRecord, audit_snapshot
from .job import (
    BakeAboveCeiling, BakeAlreadyRunning, BakeService, BakeUnknownScope,
)
from .mesh_writer import FORMAT_VERSION

__all__ = [
    "FORMAT_VERSION", "BakeAboveCeiling", "BakeAlreadyRunning", "BakeService",
    "BakeUnknownScope", "JobStatus", "Outcome", "PackRecord", "audit_snapshot",
]
