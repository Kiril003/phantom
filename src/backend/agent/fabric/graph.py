"""PlanGraph — the one data structure every mission of any scale lives in.

A bug fix and a GTA-scale game are the same machine: a DAG of typed nodes.
Scale is node count + budget, never new architecture.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

NodeKind = Literal["workstream", "gate", "artifact", "checkpoint", "submission"]
NodeStatus = Literal[
    "pending", "ready", "running", "blocked", "review", "done", "failed", "skipped"
]
GateKind = Literal["operator", "budget", "quality", "risk"]
Domain = Literal["dev", "research", "analytics", "document", "game", "generic"]

TERMINAL: frozenset[str] = frozenset({"done", "skipped"})
DEAD: frozenset[str] = frozenset({"failed"})


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class CrewSpec(BaseModel):
    roles: list[str] = Field(default_factory=list)
    size: int = 1
    lead: str | None = None


class NodeBudget(BaseModel):
    max_tokens: int = 200_000
    max_llm_calls: int = 40
    spent_tokens: int = 0
    spent_llm_calls: int = 0

    @property
    def exhausted(self) -> bool:
        return (
            self.spent_tokens >= self.max_tokens
            or self.spent_llm_calls >= self.max_llm_calls
        )

    @property
    def pressure(self) -> float:
        t = self.spent_tokens / self.max_tokens if self.max_tokens else 1.0
        c = self.spent_llm_calls / self.max_llm_calls if self.max_llm_calls else 1.0
        return min(1.0, max(t, c))


class PlanNode(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    kind: NodeKind = "workstream"
    title: str
    domain: Domain = "generic"
    depends_on: list[str] = Field(default_factory=list)
    status: NodeStatus = "pending"
    crew: CrewSpec | None = None
    gate_kind: GateKind | None = None
    budget: NodeBudget = Field(default_factory=NodeBudget)
    artifact_paths: list[str] = Field(default_factory=list)
    eta_minutes: int = 15
    attempts: int = 0
    max_attempts: int = 2
    output_summary: str | None = None
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    prompt: str = ""
    submission_graph: dict | None = None


class MissionGraph(BaseModel):
    mission_id: str
    nodes: dict[str, PlanNode] = Field(default_factory=dict)

    def add(self, node: PlanNode) -> PlanNode:
        for dep in node.depends_on:
            if dep not in self.nodes:
                raise ValueError(f"unknown dependency {dep!r} for node {node.id!r}")
        if node.id in self.nodes:
            raise ValueError(f"duplicate node id {node.id!r}")
        self.nodes[node.id] = node
        return node

    def validate_acyclic(self) -> None:
        seen: dict[str, int] = {}

        def visit(nid: str, stack: set[str]) -> None:
            if nid in stack:
                raise ValueError(f"cycle detected at node {nid!r}")
            if seen.get(nid):
                return
            stack.add(nid)
            for dep in self.nodes[nid].depends_on:
                visit(dep, stack)
            stack.discard(nid)
            seen[nid] = 1

        for nid in self.nodes:
            visit(nid, set())

    def frontier(self) -> list[PlanNode]:
        """Nodes whose every dependency is terminal — ready to dispatch."""
        out: list[PlanNode] = []
        for node in self.nodes.values():
            if node.status not in ("pending", "ready"):
                continue
            deps = [self.nodes[d] for d in node.depends_on if d in self.nodes]
            if any(d.status in DEAD and d.attempts >= d.max_attempts for d in deps):
                node.status = "blocked"
                continue
            if all(d.status in TERMINAL for d in deps):
                node.status = "ready"
                out.append(node)
        out.sort(key=lambda n: (-len(self._descendants(n.id)), n.eta_minutes))
        return out

    def _descendants(self, nid: str) -> set[str]:
        rev: dict[str, list[str]] = {}
        for node in self.nodes.values():
            for dep in node.depends_on:
                rev.setdefault(dep, []).append(node.id)
        out: set[str] = set()
        queue = list(rev.get(nid, []))
        while queue:
            cur = queue.pop()
            if cur in out:
                continue
            out.add(cur)
            queue.extend(rev.get(cur, []))
        return out

    def critical_path(self) -> list[str]:
        """Longest remaining ETA chain — drives the mission ETA in ШТАБ."""
        memo: dict[str, tuple[int, list[str]]] = {}

        def longest(nid: str) -> tuple[int, list[str]]:
            if nid in memo:
                return memo[nid]
            node = self.nodes[nid]
            own = 0 if node.status in TERMINAL else node.eta_minutes
            best: tuple[int, list[str]] = (0, [])
            for dep in node.depends_on:
                cand = longest(dep)
                if cand[0] > best[0]:
                    best = cand
            memo[nid] = (own + best[0], best[1] + [nid])
            return memo[nid]

        overall: tuple[int, list[str]] = (0, [])
        for nid in self.nodes:
            cand = longest(nid)
            if cand[0] > overall[0]:
                overall = cand
        return overall[1]

    def eta_minutes(self) -> int:
        memo: dict[str, int] = {}

        def longest(nid: str) -> int:
            if nid in memo:
                return memo[nid]
            node = self.nodes[nid]
            own = 0 if node.status in TERMINAL else node.eta_minutes
            memo[nid] = own + max(
                (longest(d) for d in node.depends_on), default=0
            )
            return memo[nid]

        return max((longest(n) for n in self.nodes), default=0)

    def progress(self) -> float:
        if not self.nodes:
            return 0.0
        done = sum(1 for n in self.nodes.values() if n.status in TERMINAL)
        return round(done / len(self.nodes), 4)

    def is_complete(self) -> bool:
        return bool(self.nodes) and all(
            n.status in TERMINAL for n in self.nodes.values()
        )

    def is_stuck(self) -> bool:
        if self.is_complete():
            return False
        active = any(
            n.status in ("running", "review", "ready", "pending")
            for n in self.nodes.values()
        )
        return not active and not self.frontier()

    def mark_running(self, nid: str) -> None:
        node = self.nodes[nid]
        node.status = "running"
        node.attempts += 1
        node.started_at = node.started_at or _now_iso()

    def mark_done(self, nid: str, summary: str | None = None) -> None:
        node = self.nodes[nid]
        node.status = "done"
        node.error = None
        node.finished_at = _now_iso()
        if summary:
            node.output_summary = summary[:2000]

    def mark_failed(self, nid: str, error: str) -> None:
        node = self.nodes[nid]
        node.error = error[:2000]
        node.finished_at = _now_iso()
        if node.attempts < node.max_attempts:
            node.status = "pending"
            node.started_at = None
            node.finished_at = None
        else:
            node.status = "failed"

    def collapse(self, nid: str) -> "MissionGraph":
        """Expand a submission node into its own nested MissionGraph."""
        node = self.nodes[nid]
        if node.kind != "submission" or not node.submission_graph:
            raise ValueError(f"node {nid!r} is not an expandable submission")
        return MissionGraph.model_validate(node.submission_graph)

    def budget_totals(self) -> NodeBudget:
        total = NodeBudget(max_tokens=0, max_llm_calls=0)
        for node in self.nodes.values():
            total.max_tokens += node.budget.max_tokens
            total.max_llm_calls += node.budget.max_llm_calls
            total.spent_tokens += node.budget.spent_tokens
            total.spent_llm_calls += node.budget.spent_llm_calls
        return total

    def to_json(self) -> str:
        return json.dumps(self.model_dump(mode="json"), ensure_ascii=False)

    @classmethod
    def from_json(cls, raw: str) -> "MissionGraph":
        return cls.model_validate(json.loads(raw))
