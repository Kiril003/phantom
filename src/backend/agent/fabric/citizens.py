"""Population — specialists become citizens with a life story.

Every node a citizen finishes (or fails) writes to their reputation:
successes, failures, revisions weathered, domains mastered, tokens
produced, last seen. Reputation is honest math over real outcomes — no
mocks (rule 1) — persisted to `polis_citizens` so a citizen's standing
survives reboots and compounds across sessions, the way lessons do.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field

from sqlalchemy import select

from db.database import get_session
from db.models import PolisCitizenRow

logger = logging.getLogger(__name__)


@dataclass
class CitizenRep:
    role: str
    successes: int = 0
    failures: int = 0
    revisions: int = 0          # extra attempts beyond the first
    tokens_produced: int = 0
    domains: dict[str, int] = field(default_factory=dict)
    last_active: float = 0.0
    recent_titles: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.successes + self.failures

    @property
    def reliability(self) -> float:
        if self.total == 0:
            return 0.0
        # success rate tempered by revision drag
        base = self.successes / self.total
        drag = 1.0 / (1.0 + self.revisions / max(self.total, 1))
        return round(base * (0.7 + 0.3 * drag), 4)

    @property
    def tier(self) -> str:
        if self.total < 3:
            return "новачок"
        r = self.reliability
        if r >= 0.9:
            return "майстер"
        if r >= 0.7:
            return "досвідчений"
        if r >= 0.4:
            return "стабільний"
        return "нестабільний"

    def to_dict(self) -> dict:
        top_domain = max(self.domains, key=self.domains.get) if self.domains else None
        return {
            "role": self.role,
            "name": self.role.replace("_", " "),
            "successes": self.successes,
            "failures": self.failures,
            "revisions": self.revisions,
            "reliability": self.reliability,
            "tier": self.tier,
            "tokens_produced": self.tokens_produced,
            "top_domain": top_domain,
            "domains": self.domains,
            "last_active": self.last_active,
            "recent_titles": self.recent_titles[-5:],
        }


class Population:
    def __init__(self) -> None:
        self._reps: dict[str, CitizenRep] = {}
        self._loaded = False

    async def load(self) -> None:
        if self._loaded:
            return
        async with get_session() as db:
            rows = list((await db.execute(select(PolisCitizenRow))).scalars().all())
        for row in rows:
            try:
                domains = json.loads(row.domains_json or "{}")
                titles = json.loads(row.recent_titles_json or "[]")
            except (json.JSONDecodeError, ValueError):
                domains, titles = {}, []
            self._reps[row.role] = CitizenRep(
                role=row.role, successes=row.successes, failures=row.failures,
                revisions=row.revisions, tokens_produced=row.tokens_produced,
                domains=domains, last_active=row.last_active or 0.0,
                recent_titles=titles,
            )
        self._loaded = True
        logger.info("polis population loaded: %d citizens", len(self._reps))

    def _rep(self, role: str) -> CitizenRep:
        return self._reps.setdefault(role, CitizenRep(role=role))

    async def record(
        self, role: str, *, ok: bool, domain: str, attempts: int,
        tokens: int, title: str,
    ) -> None:
        rep = self._rep(role)
        if ok:
            rep.successes += 1
        else:
            rep.failures += 1
        rep.revisions += max(0, attempts - 1)
        rep.tokens_produced += max(0, tokens)
        rep.domains[domain] = rep.domains.get(domain, 0) + 1
        rep.last_active = time.time()
        rep.recent_titles.append(title[:80])
        rep.recent_titles = rep.recent_titles[-10:]
        await self._persist(rep)

    async def _persist(self, rep: CitizenRep) -> None:
        async with get_session() as db:
            row = await db.get(PolisCitizenRow, rep.role)
            if row is None:
                row = PolisCitizenRow(role=rep.role)
                db.add(row)
            row.successes = rep.successes
            row.failures = rep.failures
            row.revisions = rep.revisions
            row.tokens_produced = rep.tokens_produced
            row.domains_json = json.dumps(rep.domains, ensure_ascii=False)
            row.recent_titles_json = json.dumps(rep.recent_titles, ensure_ascii=False)
            row.last_active = rep.last_active
            await db.commit()

    def reliability_of(self, role: str) -> float:
        rep = self._reps.get(role)
        return rep.reliability if rep else 0.0

    def dossier(self, role: str) -> dict:
        rep = self._reps.get(role)
        base = rep.to_dict() if rep else CitizenRep(role=role).to_dict()
        try:
            from agent.team.specialists import get_specialist
            spec = get_specialist(role)
            if spec is not None:
                base["department"] = spec.department
                base["description"] = spec.description
                base["personality"] = spec.personality
        except Exception:
            pass
        return base

    def census(self) -> list[dict]:
        try:
            from agent.team.specialists import all_specialists
            roster = [s.name for s in all_specialists()]
        except Exception:
            roster = list(self._reps.keys())
        for extra in self._reps:
            if extra not in roster:
                roster.append(extra)
        out = [self.dossier(r) for r in roster]
        out.sort(key=lambda d: (-d["reliability"], -d["successes"]))
        return out


_population: Population | None = None


def get_population() -> Population:
    global _population
    if _population is None:
        _population = Population()
    return _population
