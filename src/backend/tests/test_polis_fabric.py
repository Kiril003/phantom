"""ПОЛІС fabric — graph mechanics, pipelines shape, mesh outcome classifier."""
from __future__ import annotations

import pytest

from agent.fabric.graph import MissionGraph, NodeBudget, PlanNode
from agent.fabric import pipelines
from ai.provider_mesh import classify_outcome


def _g() -> MissionGraph:
    return MissionGraph(mission_id="m1")


def test_frontier_respects_dependencies():
    g = _g()
    a = g.add(PlanNode(id="a", title="A", prompt="x"))
    b = g.add(PlanNode(id="b", title="B", depends_on=["a"], prompt="x"))
    front = g.frontier()
    assert [n.id for n in front] == ["a"]
    g.mark_running("a")
    g.mark_done("a")
    assert [n.id for n in g.frontier()] == ["b"]
    assert a.status == "done" and b.status == "ready"


def test_frontier_prioritises_unblocking_nodes():
    g = _g()
    g.add(PlanNode(id="root", title="root", prompt="x", eta_minutes=10))
    g.add(PlanNode(id="leafy", title="leafy", prompt="x", eta_minutes=1))
    for i in range(3):
        g.add(PlanNode(id=f"c{i}", title=f"c{i}", depends_on=["root"], prompt="x"))
    front = g.frontier()
    assert front[0].id == "root"  # unblocks 3 descendants → first in wave


def test_cycle_detection():
    g = _g()
    g.add(PlanNode(id="a", title="A", prompt="x"))
    g.add(PlanNode(id="b", title="B", depends_on=["a"], prompt="x"))
    g.nodes["a"].depends_on = ["b"]
    with pytest.raises(ValueError, match="cycle"):
        g.validate_acyclic()


def test_unknown_dependency_rejected():
    g = _g()
    with pytest.raises(ValueError, match="unknown dependency"):
        g.add(PlanNode(id="x", title="X", depends_on=["ghost"], prompt="x"))


def test_retry_then_dead_blocks_descendants():
    g = _g()
    g.add(PlanNode(id="a", title="A", prompt="x", max_attempts=2))
    g.add(PlanNode(id="b", title="B", depends_on=["a"], prompt="x"))
    g.mark_running("a")
    g.mark_failed("a", "boom")
    assert g.nodes["a"].status == "pending"  # retry allowed
    g.mark_running("a")
    g.mark_failed("a", "boom again")
    assert g.nodes["a"].status == "failed"
    assert g.frontier() == []
    assert g.nodes["b"].status == "blocked"
    assert g.is_stuck()


def test_critical_path_and_eta():
    g = _g()
    g.add(PlanNode(id="a", title="A", prompt="x", eta_minutes=10))
    g.add(PlanNode(id="b", title="B", depends_on=["a"], prompt="x", eta_minutes=30))
    g.add(PlanNode(id="c", title="C", depends_on=["a"], prompt="x", eta_minutes=5))
    assert g.critical_path() == ["a", "b"]
    assert g.eta_minutes() == 40
    g.mark_running("a"); g.mark_done("a")
    assert g.eta_minutes() == 30


def test_progress_and_completion():
    g = _g()
    g.add(PlanNode(id="a", title="A", prompt="x"))
    g.add(PlanNode(id="b", title="B", prompt="x"))
    assert g.progress() == 0.0
    g.mark_running("a"); g.mark_done("a", "готово")
    assert g.progress() == 0.5
    assert not g.is_complete()
    g.mark_running("b"); g.mark_done("b")
    assert g.is_complete()
    assert g.nodes["a"].output_summary == "готово"


def test_budget_totals_and_pressure():
    g = _g()
    g.add(PlanNode(id="a", title="A", prompt="x",
                   budget=NodeBudget(max_tokens=100, max_llm_calls=10,
                                     spent_tokens=90, spent_llm_calls=1)))
    total = g.budget_totals()
    assert total.spent_tokens == 90
    assert total.pressure == 0.9
    assert not total.exhausted
    g.nodes["a"].budget.spent_tokens = 100
    assert g.budget_totals().exhausted


def test_json_roundtrip_preserves_graph():
    g = build_sample()
    raw = g.to_json()
    g2 = MissionGraph.from_json(raw)
    assert g2.nodes.keys() == g.nodes.keys()
    assert g2.critical_path() == g.critical_path()


def build_sample() -> MissionGraph:
    g = _g()
    g.add(PlanNode(id="a", title="A", prompt="x"))
    g.add(PlanNode(id="b", title="B", depends_on=["a"], prompt="x"))
    return g


def test_submission_collapse():
    inner = build_sample()
    g = _g()
    g.add(PlanNode(id="sub", title="Sub", kind="submission", prompt="x",
                   submission_graph=inner.model_dump(mode="json")))
    nested = g.collapse("sub")
    assert set(nested.nodes) == {"a", "b"}
    with pytest.raises(ValueError):
        build_sample().collapse("a")


def test_attach_children_recursive_decomposition():
    g = _g()
    up = g.add(PlanNode(id="up", title="upstream", prompt="x"))
    big = g.add(PlanNode(id="big", title="big", depends_on=["up"], prompt="x"))
    down = g.add(PlanNode(id="down", title="down", depends_on=["big"], prompt="x"))
    # upstream done → big is the frontier and gets expanded in place
    g.mark_running("up"); g.mark_done("up")
    assert [n.id for n in g.frontier()] == ["big"]

    kids = [PlanNode(title="k1", prompt="a"), PlanNode(title="k2", prompt="b")]
    ids = g.attach_children("big", kids)

    assert big.decomposed and big.status == "pending" and big.attempts == 0
    # children inherit big's upstream deps and its depth+1, and are ready now
    for cid in ids:
        assert g.nodes[cid].depends_on == ["up"]
        assert g.nodes[cid].depth == 1
    assert set(ids) == {n.id for n in g.frontier()}   # children, not big, run next
    assert big.depends_on == ids                       # big now integrates them
    assert down.depends_on == ["big"]                  # downstream untouched
    g.validate_acyclic()

    # children finish → big returns to the frontier as integrator
    for cid in ids:
        g.mark_running(cid); g.mark_done(cid)
    assert [n.id for n in g.frontier()] == ["big"]


def test_attach_children_stays_acyclic_and_json_safe():
    g = _g()
    root = g.add(PlanNode(id="root", title="root", prompt="x"))
    g.attach_children("root", [PlanNode(title="c1", prompt="a"),
                               PlanNode(title="c2", prompt="b")])
    g.validate_acyclic()
    g2 = MissionGraph.from_json(g.to_json())
    assert g2.nodes["root"].decomposed is True
    assert all(n.depth == 1 for n in g2.nodes.values() if n.id != "root")


@pytest.mark.parametrize("text,expected_titles", [
    ('```spawn\n[{"title":"A","prompt":"pa"},{"title":"B","prompt":"pb"}]\n```', ["A", "B"]),
    ('nope, just did the work', []),                              # no fence
    ('```spawn\n[{"title":"only","prompt":"p"}]\n```', []),        # <2 → not a split
    ('```spawn\n[{"title":"A"},{"prompt":"p"}]\n```', []),         # invalid items
    ('```spawn\nnot json\n```', []),                              # garbage
])
def test_parse_spawn(text, expected_titles):
    from agent.fabric.service import PolisService
    got = [c["title"] for c in PolisService._parse_spawn(text)]
    assert got == expected_titles


# ── pipelines shape ──────────────────────────────────────────────────────


@pytest.mark.parametrize("name,builder", [
    ("dev_studio", pipelines.build_dev_studio),
    ("research_library", pipelines.build_research_library),
    ("observatory", pipelines.build_observatory),
    ("scriptorium", pipelines.build_scriptorium),
    ("game_studio", pipelines.build_game_studio),
])
def test_pipeline_graphs_are_valid_dags(name, builder):
    g = builder("тестовий бриф")
    g.validate_acyclic()
    assert len(g.nodes) >= 4
    assert g.frontier(), f"{name}: no startable nodes"
    assert all(n.prompt for n in g.nodes.values())
    roots = [n for n in g.nodes.values() if not n.depends_on]
    assert roots, f"{name}: DAG must have a root"


def test_pipeline_domains_registered():
    assert set(pipelines.PIPELINES) == {
        "dev_studio", "research_library", "observatory",
        "scriptorium", "game_studio", "generic",
    }


@pytest.mark.asyncio
async def test_generic_fallback_single_node(monkeypatch):
    import ai.provider_mesh as mesh_mod

    class BoomMesh:
        async def generate(self, **kw):
            raise RuntimeError("no provider in tests")

    monkeypatch.setattr(mesh_mod, "get_mesh", lambda: BoomMesh())
    g = await pipelines.build_generic("зроби X")
    assert len(g.nodes) == 1
    node = next(iter(g.nodes.values()))
    assert node.prompt == "зроби X"


# ── mesh outcome classification ──────────────────────────────────────────


@pytest.mark.parametrize("msg,expected", [
    ("429 Too Many Requests", "rate_limited"),
    ("Resource exhausted: quota exceeded", "quota"),
    ("401 API key not valid", "auth_fail"),
    ("PERMISSION_DENIED for project", "auth_fail"),
    ("Internal server error 500", "server_error"),
])
def test_classify_outcome(msg, expected):
    assert classify_outcome(RuntimeError(msg)) == expected
