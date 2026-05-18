"""
Knowledge Objects (KO) — structured project-wide facts.
Replaces the 'decaying' conversational context with deterministic knowledge.
"""
from __future__ import annotations

import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

class KnowledgeObject:
    def __init__(self, key: str, subject: str, predicate: str, object_val: str, context: str = ""):
        self.key = key
        self.subject = subject
        self.predicate = predicate
        self.object_val = object_val
        self.context = context
        self.timestamp = datetime.now(tz=timezone.utc).isoformat()
        self.version = 1

    def to_dict(self) -> dict:
        return self.__dict__

class KnowledgeBase:
    def __init__(self, storage_path: str):
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._data: Dict[str, KnowledgeObject] = {}
        self._load()

    def _load(self):
        if self.storage_path.exists():
            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                    for k, v in raw.items():
                        obj = KnowledgeObject(v["key"], v["subject"], v["predicate"], v["object_val"], v.get("context", ""))
                        obj.timestamp = v["timestamp"]
                        obj.version = v.get("version", 1)
                        self._data[k] = obj
            except Exception as e:
                logger.error(f"KB load failed: {e}")

    def _save(self):
        try:
            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump({k: v.to_dict() for k, v in self._data.items()}, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"KB save failed: {e}")

    def upsert(self, subject: str, predicate: str, object_val: str, context: str = ""):
        import hashlib
        key = hashlib.sha256(f"{subject}|{predicate}".encode()).hexdigest()[:16]
        obj = KnowledgeObject(key, subject, predicate, object_val, context)
        self._data[key] = obj
        self._save()

    def query(self, query_text: str) -> List[str]:
        # Simple keyword matching for now, can be upgraded to semantic later
        results = []
        q = query_text.lower()
        for obj in self._data.values():
            if q in obj.subject.lower() or q in obj.predicate.lower() or q in obj.object_val.lower():
                results.append(f"[{obj.subject}] {obj.predicate} -> {obj.object_val}")
        return results

    def get_all_formatted(self) -> str:
        if not self._data:
            return "Knowledge Base is empty."
        lines = ["PROJECT KNOWLEDGE OBJECTS:"]
        for obj in self._data.values():
            lines.append(f"- {obj.subject}: {obj.predicate} is {obj.object_val}")
        return "\n".join(lines)

# Singleton per user (can be expanded)
project_kb = KnowledgeBase(os.path.expanduser("~/.phantom/knowledge_base.json"))
