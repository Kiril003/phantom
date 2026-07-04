"""ПОЛІС service — the governor that runs every mission graph in waves.

One asyncio loop per mission; a global semaphore caps concurrent node
executions at the Radxa-proven ceiling. Every node transition persists
to SQLite and broadcasts on the "polis" WS channel, so the city UI is a
pure render of real state.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from db.database import get_session
from db.models import PolisMissionRow

from agent.fabric.graph import CrewSpec, MissionGraph, PlanNode
from agent.fabric.pipelines import PIPELINES, plan_mission

logger = logging.getLogger(__name__)

MAX_WAVE = 4
_POLIS_HOME = os.path.expanduser("~/.phantom/polis")


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class Gate:
    def __init__(self, mission_id: str, node_id: str, kind: str, question: str,
                 preview: str | None = None) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.mission_id = mission_id
        self.node_id = node_id
        self.kind = kind
        self.question = question
        self.payload_preview = preview
        self.opened_at = _now_iso()
        self.event = asyncio.Event()
        self.approved = False

    def to_dict(self) -> dict:
        return {
            "id": self.id, "mission_id": self.mission_id, "node_id": self.node_id,
            "kind": self.kind, "question": self.question,
            "payload_preview": self.payload_preview, "opened_at": self.opened_at,
        }


class ActiveMission:
    def __init__(self, row_id: str, user_id: str, title: str, brief: str,
                 pipeline: str, graph: MissionGraph,
                 chat: list[dict] | None = None) -> None:
        self.id = row_id
        self.user_id = user_id
        self.title = title
        self.brief = brief
        self.pipeline = pipeline
        self.domain = PIPELINES.get(pipeline, "generic")
        self.graph = graph
        self.status = "running"
        self.created_at = _now_iso()
        self.task: asyncio.Task | None = None
        self.pause = asyncio.Event()
        self.pause.set()  # set = running
        self.chat: list[dict] = chat or []
        self.transcripts: dict[str, str] = {}

    def to_dict(self) -> dict:
        return {
            "id": self.id, "title": self.title, "brief": self.brief,
            "pipeline": self.pipeline, "domain": self.domain,
            "status": self.status,
            "nodes": [self._node_dict(n) for n in self.graph.nodes.values()],
            "progress": self.graph.progress(),
            "critical_path": self.graph.critical_path(),
            "eta_minutes": self.graph.eta_minutes(),
            "budget": self.graph.budget_totals().model_dump(),
            "created_at": self.created_at, "updated_at": _now_iso(),
        }

    @staticmethod
    def _node_dict(n: PlanNode) -> dict:
        d = n.model_dump(mode="json", exclude={"prompt", "submission_graph"})
        d["crew"] = n.crew.model_dump() if n.crew else None
        return d


class PolisService:
    def __init__(self) -> None:
        self.missions: dict[str, ActiveMission] = {}
        self.gates: dict[str, Gate] = {}
        self.sem = asyncio.Semaphore(MAX_WAVE)
        self._role_stats: dict[str, int] = {}

    # ── broadcast ──────────────────────────────────────────────────────

    async def _emit(self, type_: str, data: dict) -> None:
        try:
            from api.websocket_hub import hub
            await hub.broadcast("polis", type_, data)
        except Exception:
            pass

    # ── persistence ────────────────────────────────────────────────────

    async def _persist(self, m: ActiveMission) -> None:
        async with get_session() as db:
            row = await db.get(PolisMissionRow, m.id)
            if row is None:
                return
            row.status = m.status
            row.graph_json = m.graph.to_json()
            row.chat_json = json.dumps(m.chat[-200:], ensure_ascii=False)
            await db.commit()

    async def rehydrate(self) -> None:
        """Resume unfinished missions after a reboot — missions survive."""
        async with get_session() as db:
            stmt = select(PolisMissionRow).where(
                PolisMissionRow.status.in_(("planning", "running", "awaiting_gate"))
            )
            rows = list((await db.execute(stmt)).scalars().all())
        for row in rows:
            try:
                graph = MissionGraph.from_json(row.graph_json)
            except Exception:
                continue
            for node in graph.nodes.values():
                if node.status in ("running", "review", "ready"):
                    node.status = "pending"
                    node.started_at = None
            try:
                chat = json.loads(row.chat_json or "[]")
            except (json.JSONDecodeError, ValueError):
                chat = []
            m = ActiveMission(row.id, row.user_id, row.title, row.brief,
                              row.pipeline, graph, chat=chat)
            self.missions[m.id] = m
            m.task = asyncio.create_task(self._run(m))
            logger.info("polis: rehydrated mission %s (%s)", m.id, m.title)

    # ── lifecycle ──────────────────────────────────────────────────────

    async def create_mission(self, user_id: str, brief: str,
                             pipeline: str = "generic",
                             title: str | None = None) -> ActiveMission:
        graph = await plan_mission(brief, pipeline)
        row_id = graph.mission_id
        title = (title or brief.strip().splitlines()[0])[:120]
        row = PolisMissionRow(
            id=row_id, user_id=user_id, title=title, brief=brief,
            pipeline=pipeline, domain=PIPELINES.get(pipeline, "generic"),
            status="running", graph_json=graph.to_json(),
        )
        async with get_session() as db:
            db.add(row)
            await db.flush()
        m = ActiveMission(row_id, user_id, title, brief, pipeline, graph)
        self.missions[m.id] = m
        os.makedirs(os.path.join(_POLIS_HOME, m.id), exist_ok=True)
        m.task = asyncio.create_task(self._run(m))
        await self._emit("mission_status", {"mission": m.to_dict()})
        return m

    def pause_mission(self, mission_id: str) -> bool:
        m = self.missions.get(mission_id)
        if not m:
            return False
        m.pause.clear()
        m.status = "paused"
        return True

    def resume_mission(self, mission_id: str) -> bool:
        m = self.missions.get(mission_id)
        if not m:
            return False
        m.status = "running"
        m.pause.set()
        return True

    async def kill_mission(self, mission_id: str) -> bool:
        m = self.missions.get(mission_id)
        if not m:
            return False
        m.status = "killed"
        if m.task:
            m.task.cancel()
        await self._persist(m)
        await self._emit("mission_status", {"mission": m.to_dict()})
        return True

    async def resolve_gate(self, gate_id: str, approved: bool) -> bool:
        gate = self.gates.get(gate_id)
        if not gate:
            return False
        gate.approved = approved
        gate.event.set()
        return True

    # ── mission chat — the operator steers with words ──────────────────

    async def _chat_append(self, m: ActiveMission, msg: dict) -> None:
        msg["ts"] = _now_iso()
        m.chat.append(msg)
        await self._emit("chat_message", {"mission_id": m.id, "message": msg})

    async def _chat_system(self, m: ActiveMission, text: str,
                           node_id: str | None = None) -> None:
        await self._chat_append(m, {"role": "system", "text": text,
                                    "node_id": node_id})

    def add_node(self, mission_id: str, *, title: str, prompt: str,
                 after: list[str] | None = None, role: str | None = None) -> str:
        """Rolling-wave: inject a node into a live graph; the frontier
        picks it up on the next wave."""
        m = self.missions[mission_id]
        deps = [d for d in (after or []) if d in m.graph.nodes]
        node = PlanNode(
            title=title[:120], prompt=prompt, domain=m.domain,
            depends_on=deps,
            crew=CrewSpec(roles=[role], size=1) if role else None,
        )
        m.graph.add(node)
        return node.id

    _STEER_SYSTEM = (
        "Ти — PHANTOM, керівник місії у власному Полісі. Оператор пише тобі "
        "посеред виконання. Ти бачиш стан графа місії. Відповідай стисло і по "
        "суті українською, а якщо треба ЗМІНИТИ хід місії — додай дії.\n"
        "Формат відповіді — ТІЛЬКИ JSON:\n"
        '{"reply": "текст оператору", "actions": [\n'
        '  {"type": "add_node", "title": "...", "prompt": "повне ТЗ для '
        'воркера", "after": ["node_id", "..."]},\n'
        '  {"type": "pause"} | {"type": "resume"} |\n'
        '  {"type": "approve_gate", "gate_id": "..."} | '
        '{"type": "deny_gate", "gate_id": "..."}\n'
        "]}\n"
        "Дій додавай тільки коли оператор явно просить змінити роботу. "
        "Питання про стан → просто reply з фактами зі стану."
    )

    def _mission_state_brief(self, m: ActiveMission) -> str:
        lines = [
            f"Місія: {m.title} [{m.status}] прогрес {int(m.graph.progress() * 100)}%",
            f"Бриф: {m.brief[:400]}",
            "Вузли:",
        ]
        for n in m.graph.nodes.values():
            lines.append(
                f"  {n.id} [{n.status}] {n.title}"
                + (f" → {n.output_summary[:100]}" if n.output_summary else "")
                + (f" ✗ {n.error[:80]}" if n.error else "")
            )
        for g in self.gates.values():
            if g.mission_id == m.id:
                lines.append(f"Відкритий gate {g.id}: {g.question}")
        return "\n".join(lines)

    async def chat(self, mission_id: str, text: str) -> dict:
        m = self.missions.get(mission_id)
        if m is None:
            raise KeyError(mission_id)
        await self._chat_append(m, {"role": "operator", "text": text})

        from ai.provider_mesh import get_mesh
        history = [
            {"role": "user" if c["role"] == "operator" else "assistant",
             "content": c["text"]}
            for c in m.chat[-12:-1] if c["role"] in ("operator", "phantom")
        ]
        applied: list[str] = []
        try:
            resp = await get_mesh().generate(
                system_prompt=self._STEER_SYSTEM + "\n\nСТАН:\n"
                + self._mission_state_brief(m),
                user_message=text,
                history=history,
                user_id=m.user_id,
            )
            raw = getattr(resp, "text", "") or ""
            match = re.search(r"\{.*\}", raw, re.S)
            payload = json.loads(match.group(0)) if match else {"reply": raw}
        except Exception as exc:
            logger.warning("mission chat LLM failed: %s", exc)
            payload = {
                "reply": "Зв'язок з розумом міста зараз слабкий — стан місії: "
                + self._mission_state_brief(m)[:400],
                "actions": [],
            }

        for act in payload.get("actions", []) or []:
            try:
                kind = act.get("type")
                if kind == "add_node":
                    nid = self.add_node(
                        m.id, title=act.get("title", "Додатковий крок"),
                        prompt=act.get("prompt", ""), after=act.get("after"),
                    )
                    applied.append(f"add_node:{nid}")
                elif kind == "pause":
                    self.pause_mission(m.id)
                    applied.append("pause")
                elif kind == "resume":
                    self.resume_mission(m.id)
                    applied.append("resume")
                elif kind in ("approve_gate", "deny_gate"):
                    ok = await self.resolve_gate(
                        act.get("gate_id", ""), kind == "approve_gate"
                    )
                    if ok:
                        applied.append(kind)
            except Exception as exc:
                logger.warning("chat action %s failed: %s", act, exc)

        reply = {
            "role": "phantom",
            "text": str(payload.get("reply", ""))[:4000],
            "applied": applied,
        }
        await self._chat_append(m, reply)
        await self._persist(m)
        if applied:
            await self._emit("mission_status", {"mission": m.to_dict()})
        return reply

    # ── file forge — workers emit real file trees ───────────────────────

    _FILE_FENCE = re.compile(r"```file:([^\n`]+)\n(.*?)```", re.S)
    _MAX_FORGED = 40

    @staticmethod
    def _safe_rel(path: str) -> str | None:
        rel = os.path.normpath(path.strip().lstrip("/"))
        if rel.startswith("..") or os.path.isabs(rel) or rel in (".", ""):
            return None
        return rel

    def _forge_files(self, m: ActiveMission, node: PlanNode, text: str) -> list[str]:
        forged: list[str] = []
        base = os.path.join(_POLIS_HOME, m.id, "workspace")
        for match in self._FILE_FENCE.finditer(text):
            if len(forged) >= self._MAX_FORGED:
                break
            rel = self._safe_rel(match.group(1))
            if rel is None:
                continue
            path = os.path.join(base, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(match.group(2)[:600_000])
            node.artifact_paths.append(path)
            forged.append(rel)
        return forged

    # ── artifacts & workers — everything visible ────────────────────────

    def list_artifacts(self, mission_id: str) -> list[dict]:
        m = self.missions.get(mission_id)
        base = os.path.join(_POLIS_HOME, mission_id)
        out: list[dict] = []
        if not os.path.isdir(base):
            return out

        def _entry(rel: str, path: str) -> dict:
            stem = os.path.splitext(os.path.basename(rel))[0]
            node = m.graph.nodes.get(stem) if m else None
            st = os.stat(path)
            return {
                "name": rel,
                "node_id": stem if node else None,
                "title": node.title if node else rel,
                "size": st.st_size,
                "updated_at": datetime.fromtimestamp(
                    st.st_mtime, tz=timezone.utc
                ).isoformat(),
            }

        for name in sorted(os.listdir(base)):
            path = os.path.join(base, name)
            if os.path.isfile(path):
                out.append(_entry(name, path))
        ws = os.path.join(base, "workspace")
        for root, _dirs, files in os.walk(ws):
            for fname in sorted(files):
                path = os.path.join(root, fname)
                rel = os.path.relpath(path, base)
                out.append(_entry(rel, path))
        return out

    def read_artifact(self, mission_id: str, name: str) -> str | None:
        rel = self._safe_rel(name)
        if rel is None:
            return None
        path = os.path.join(_POLIS_HOME, mission_id, rel)
        if not os.path.isfile(path):
            return None
        with open(path, encoding="utf-8") as f:
            return f.read()[:400_000]

    def workers(self, mission_id: str) -> list[dict]:
        m = self.missions.get(mission_id)
        if m is None:
            return []
        out = []
        for n in m.graph.nodes.values():
            transcript = m.transcripts.get(n.id, "")
            if not transcript and n.status in ("pending", "ready"):
                continue
            out.append({
                "node_id": n.id,
                "title": n.title,
                "role": (n.crew.roles[0] if n.crew and n.crew.roles else None),
                "status": n.status,
                "chars": len(transcript),
                "tail": transcript[-600:],
                "spent_llm_calls": n.budget.spent_llm_calls,
            })
        return out

    def worker_transcript(self, mission_id: str, node_id: str) -> str:
        m = self.missions.get(mission_id)
        if m is None:
            return ""
        text = m.transcripts.get(node_id, "")
        if not text:
            node = m.graph.nodes.get(node_id)
            for p in (node.artifact_paths if node else []):
                try:
                    with open(p, encoding="utf-8") as f:
                        text = f.read()[:400_000]
                except OSError:
                    pass
        return text

    # ── the wave loop ──────────────────────────────────────────────────

    async def _run(self, m: ActiveMission) -> None:
        try:
            while not m.graph.is_complete():
                await m.pause.wait()
                if m.status == "killed":
                    return
                frontier = m.graph.frontier()
                if not frontier:
                    if m.graph.is_stuck():
                        m.status = "failed"
                        break
                    await asyncio.sleep(1.0)
                    continue
                await self._emit("wave", {
                    "mission_id": m.id,
                    "size": min(len(frontier), MAX_WAVE),
                    "queued": max(0, len(frontier) - MAX_WAVE),
                })
                await asyncio.gather(
                    *(self._run_node(m, n) for n in frontier[:MAX_WAVE])
                )
                await self._persist(m)
            if m.status not in ("failed", "killed"):
                m.status = "done"
        except asyncio.CancelledError:
            return
        except Exception as exc:
            logger.error("polis mission %s crashed: %s", m.id, exc)
            m.status = "failed"
        finally:
            await self._persist(m)
            await self._emit("mission_status", {"mission": m.to_dict()})

    async def _run_node(self, m: ActiveMission, node: PlanNode) -> None:
        async with self.sem:
            m.graph.mark_running(node.id)
            await self._node_event(m, node)
            try:
                if node.kind == "gate" and node.gate_kind == "operator":
                    await self._operator_gate(m, node)
                else:
                    await self._execute(m, node)
            except Exception as exc:
                m.graph.mark_failed(node.id, str(exc))
            await self._node_event(m, node)
            if node.status == "done":
                await self._chat_system(
                    m, f"✓ «{node.title}» виконано" +
                    (f" — {node.output_summary[:120]}" if node.output_summary else ""),
                    node_id=node.id,
                )
            elif node.status == "failed":
                await self._chat_system(
                    m, f"✗ «{node.title}» зірвано: {node.error or 'невідома причина'}",
                    node_id=node.id,
                )
            await self._budget_watch(m)

    async def _execute(self, m: ActiveMission, node: PlanNode) -> None:
        context = self._dep_context(m, node)
        role = (node.crew.roles[0] if node.crew and node.crew.roles else None)
        system = self._role_system(role)
        from ai.provider_mesh import get_mesh
        t0 = time.monotonic()

        m.transcripts[node.id] = ""
        buf: list[str] = []
        last_emit = 0.0

        async def on_delta(delta: str) -> None:
            nonlocal last_emit
            m.transcripts[node.id] += delta
            buf.append(delta)
            now = time.monotonic()
            if now - last_emit >= 0.4 or sum(len(b) for b in buf) > 400:
                await self._emit("worker_delta", {
                    "mission_id": m.id, "node_id": node.id,
                    "delta": "".join(buf),
                    "total_chars": len(m.transcripts[node.id]),
                })
                buf.clear()
                last_emit = now

        text = await get_mesh().generate_stream(
            system_prompt=system,
            user_message=(context + "\n\n" + node.prompt).strip(),
            on_delta=on_delta,
        )
        if buf:
            await self._emit("worker_delta", {
                "mission_id": m.id, "node_id": node.id,
                "delta": "".join(buf),
                "total_chars": len(m.transcripts[node.id]),
            })

        forged = self._forge_files(m, node, text)
        if forged:
            await self._chat_system(
                m,
                f"⚒ «{node.title}» викував {len(forged)} файл(и): "
                + ", ".join(forged[:5]) + ("…" if len(forged) > 5 else ""),
                node_id=node.id,
            )
        node.budget.spent_llm_calls += 1
        node.budget.spent_tokens += max(1, len(text) // 4)
        node.eta_minutes = max(1, int((time.monotonic() - t0) / 60) or node.eta_minutes)
        path = os.path.join(_POLIS_HOME, m.id, f"{node.id}.md")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# {node.title}\n\n{text}\n")
        node.artifact_paths = [path]
        if role:
            self._role_stats[role] = self._role_stats.get(role, 0) + 1
        summary = text.strip().replace("\n", " ")[:400]
        if node.kind == "gate" and node.gate_kind in ("quality", "risk"):
            verdict_ok = "SHIP" in text[:2000].upper() or "БЛОКЕР" not in text.upper()
            if not verdict_ok:
                m.graph.mark_failed(node.id, "quality gate: блокери — " + summary)
                return
        m.graph.mark_done(node.id, summary)

    async def _operator_gate(self, m: ActiveMission, node: PlanNode) -> None:
        preview = self._dep_context(m, node)[:600] or None
        gate = Gate(m.id, node.id, "operator", node.prompt or node.title, preview)
        self.gates[gate.id] = gate
        node.status = "review"
        prev = m.status
        m.status = "awaiting_gate"
        await self._emit("gate_opened", {"gate": gate.to_dict()})
        await self._persist(m)
        await gate.event.wait()
        del self.gates[gate.id]
        m.status = prev if prev != "awaiting_gate" else "running"
        await self._emit("gate_closed", {"gate_id": gate.id, "approved": gate.approved})
        if gate.approved:
            m.graph.mark_done(node.id, "оператор схвалив")
        else:
            node.status = "skipped"
            node.finished_at = _now_iso()
            m.pause.clear()
            m.status = "paused"

    async def _budget_watch(self, m: ActiveMission) -> None:
        pressure = m.graph.budget_totals().pressure
        if pressure >= 1.0 and m.pause.is_set():
            m.pause.clear()
            m.status = "paused"
            gate = Gate(m.id, "", "budget",
                        "Бюджет місії вичерпано. Продовжити з подвоєним лімітом?")
            self.gates[gate.id] = gate
            await self._emit("gate_opened", {"gate": gate.to_dict()})

            async def waiter() -> None:
                await gate.event.wait()
                self.gates.pop(gate.id, None)
                if gate.approved:
                    for n in m.graph.nodes.values():
                        n.budget.max_tokens *= 2
                        n.budget.max_llm_calls *= 2
                    m.status = "running"
                    m.pause.set()
                await self._emit("gate_closed",
                                 {"gate_id": gate.id, "approved": gate.approved})
            asyncio.create_task(waiter())
        elif pressure >= 0.8:
            await self._emit("budget_alert",
                             {"mission_id": m.id, "pressure": round(pressure, 2)})

    def _dep_context(self, m: ActiveMission, node: PlanNode) -> str:
        parts = []
        for dep_id in node.depends_on:
            dep = m.graph.nodes.get(dep_id)
            if not dep:
                continue
            body = ""
            for p in dep.artifact_paths:
                try:
                    with open(p, encoding="utf-8") as f:
                        body = f.read()[:12_000]
                except OSError:
                    body = dep.output_summary or ""
            parts.append(f"── Результат кроку «{dep.title}» ──\n{body}")
        return "\n\n".join(parts)

    @staticmethod
    def _role_system(role: str | None) -> str:
        base = (
            "Ти — громадянин Поліса, внутрішнього міста PHANTOM OS. Працюєш у "
            "команді: твій результат читатимуть наступні кроки, тому пиши повно, "
            "конкретно, без води і без заглушок. Коли створюєш файл коду чи "
            "документа — подавай його БЛОКОМ:\n"
            "```file:шлях/до/файлу.ext\n<повний вміст>\n```\n"
            "— кожен такий блок стає справжнім файлом у робочому просторі місії."
        )
        if not role:
            return base
        try:
            from agent.team.specialists import get_specialist
            spec = get_specialist(role)
            if spec is not None:
                return base + "\nТвоя роль: " + spec.description
        except Exception:
            pass
        return base + f"\nТвоя роль: {role}."

    async def _node_event(self, m: ActiveMission, node: PlanNode) -> None:
        await self._emit("node_status", {
            "mission_id": m.id,
            "node": ActiveMission._node_dict(node),
            "progress": m.graph.progress(),
        })

    # ── snapshot for UI ────────────────────────────────────────────────

    async def snapshot(self) -> dict:
        citizens = self._citizens()
        try:
            from ai.keyvault import get_vault
            keys = await get_vault().list_keys()
        except Exception:
            keys = []
        running = sum(
            1 for m in self.missions.values()
            for n in m.graph.nodes.values() if n.status == "running"
        )
        queued = sum(
            1 for m in self.missions.values()
            for n in m.graph.nodes.values() if n.status in ("pending", "ready")
        )
        hour = datetime.now().hour
        return {
            "missions": [m.to_dict() for m in self.missions.values()],
            "citizens": citizens,
            "keys": keys,
            "gates": [g.to_dict() for g in self.gates.values()],
            "governor": {
                "wave_size": MAX_WAVE - self.sem._value,  # noqa: SLF001
                "max_wave": MAX_WAVE,
                "running_nodes": running,
                "queued_nodes": queued,
                "night_mode": hour >= 23 or hour < 7,
            },
        }

    def _citizens(self) -> list[dict]:
        out: list[dict] = []
        busy: dict[str, tuple[str, str, str]] = {}
        for m in self.missions.values():
            for n in m.graph.nodes.values():
                if n.status in ("running", "review") and n.crew:
                    for role in n.crew.roles or ["generalist"]:
                        act = "reviewing" if n.status == "review" else "working"
                        busy[role] = (m.id, n.id, act)
        try:
            from agent.team.specialists import all_specialists
            roster = [(s.name, s.name) for s in all_specialists()]
        except Exception:
            roster = [(r, r) for r in busy]
        for name, role in roster:
            b = busy.get(role)
            m_id, n_id, act = b if b else (None, None, "idle")
            domain = "plaza"
            if m_id and m_id in self.missions:
                domain = self.missions[m_id].domain
            out.append({
                "id": role, "name": name.replace("_", " "), "role": role,
                "district": domain if b else "plaza",
                "activity": act, "mission_id": m_id, "node_id": n_id,
                "missions_done": self._role_stats.get(role, 0),
            })
        return out


_service: PolisService | None = None


def get_polis() -> PolisService:
    global _service
    if _service is None:
        _service = PolisService()
    return _service
