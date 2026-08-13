"""tool_registry is a view over the legacy tool world, not a second one.

G1.1 splits the tool monolith in stages: the typed *index* (ToolSpec per
capability, gate tier, views) now lives in ``tool_registry/families/*``,
while the handler *bodies* stay in ``ai/tool_executor.py`` until a family
is migrated wholesale. That staging is only safe while the two cannot
drift apart, which is what this module pins.

The failure it exists to prevent: someone adds a tool to
``ai/tool_executor._HANDLERS`` and forgets the family module. Nothing
would break — the legacy path still serves it — but the registry would
silently under-report the arsenal, and every consumer reading the
registry (the provider adapters) would lose the tool. That is exactly
the "two arsenals" split the package docstring forbids.

This already caught one real drift: ``tool_registry.spec``'s copy of the
chat-safe allowlist was 4 names behind the dispatcher's (create_workbench,
refine_workbench, list_workbenches, show_image), so wiring the registry in
would have silently revoked chat access to the Atelier workbench tools and
inline images.
"""
from __future__ import annotations

import pytest

import tool_registry as tr
from ai.chat_tool_dispatcher import _CHAT_SAFE_TOOL_NAMES as DISPATCHER_ALLOWLIST
from ai.chat_tools import CHAT_DATA_TOOLS as LEGACY_DECLARATIONS
from ai.tool_executor import _HANDLERS as LEGACY_HANDLERS
from tool_registry.spec import CHAT_SAFE_TOOL_NAMES


def test_every_legacy_handler_has_a_family():
    """A tool in _HANDLERS but in no family is invisible to the registry."""
    missing = sorted(set(LEGACY_HANDLERS) - set(tr.registry().names()))
    assert not missing, (
        f"{len(missing)} tool(s) in ai.tool_executor._HANDLERS have no "
        f"tool_registry family: {missing}\n"
        "Add each to the matching module under tool_registry/families/ "
        "(the family lists the tool name; the handler body stays put)."
    )


def test_registry_invents_no_tools():
    """The reverse: a family must not list a tool that has no handler."""
    extra = sorted(set(tr.registry().names()) - set(LEGACY_HANDLERS))
    assert not extra, f"registry declares tools with no handler: {extra}"


def test_registry_wraps_the_same_function_objects():
    """One arsenal: the spec's handler IS the legacy handler, not a copy."""
    divergent = [
        name for name, fn in LEGACY_HANDLERS.items()
        if tr.registry().get(name).handler is not fn
    ]
    assert not divergent, (
        f"registry holds a different function object for: {divergent} — "
        "the registry must index the live handlers, never re-implement them."
    )


@pytest.mark.parametrize("name", sorted({d["name"] for d in LEGACY_DECLARATIONS}))
def test_declaration_is_byte_identical(name: str):
    """What the LLM sees must not change by routing through the registry."""
    legacy = next(d for d in LEGACY_DECLARATIONS if d["name"] == name)
    assert tr.get_tool_schema(name) == legacy


def test_data_tool_names_match_legacy():
    assert tr.DATA_TOOL_NAMES == frozenset(d["name"] for d in LEGACY_DECLARATIONS)


def test_chat_safe_allowlist_matches_the_dispatcher():
    """The dispatcher enforces; the registry mirrors. Drift is a security gap.

    A name the dispatcher allows but the registry omits loses chat access
    the moment a consumer reads the registry's "chat" view; a name the
    registry adds but the dispatcher rejects is a phantom capability.
    """
    assert CHAT_SAFE_TOOL_NAMES == frozenset(DISPATCHER_ALLOWLIST), (
        "tool_registry.spec.CHAT_SAFE_TOOL_NAMES has drifted from "
        "ai.chat_tool_dispatcher._CHAT_SAFE_TOOL_NAMES.\n"
        f"  registry only:   {sorted(CHAT_SAFE_TOOL_NAMES - set(DISPATCHER_ALLOWLIST))}\n"
        f"  dispatcher only: {sorted(set(DISPATCHER_ALLOWLIST) - CHAT_SAFE_TOOL_NAMES)}"
    )


def test_chat_view_is_exactly_the_allowlist():
    assert set(tr.registry().names("chat")) == set(DISPATCHER_ALLOWLIST)


def test_every_allowlisted_tool_is_dispatchable():
    """An allowlisted name with no handler would 'unknown_tool' at runtime."""
    orphaned = sorted(set(DISPATCHER_ALLOWLIST) - set(LEGACY_HANDLERS))
    assert not orphaned, f"allowlisted but no handler: {orphaned}"


def test_effective_timeouts_match_legacy():
    """Routing through the registry must not change any tool's wall clock.

    The registry resolves `spec.timeout_s or TOOL_TIMEOUT_S`; the legacy path
    resolves `PER_TOOL_TIMEOUT_S.get(name, TOOL_TIMEOUT_S)`. The legacy table
    is keyed by names that match no handler ("web_search" — the real tool is
    `search_web`), so it never fires and every tool gets the 30s default.

    The first draft of the registry's table re-keyed that dead bump as
    `search_web: 25.0`, but the default had since risen 10s → 30s, making the
    "bump" a 5s cut to the one tool it meant to protect — a regression that
    would only have surfaced once the registry became the dispatch path.
    """
    from ai.tool_executor import PER_TOOL_TIMEOUT_S, TOOL_TIMEOUT_S

    mismatched = {}
    for name in LEGACY_HANDLERS:
        legacy = PER_TOOL_TIMEOUT_S.get(name, TOOL_TIMEOUT_S)
        spec = tr.registry().get(name)
        effective = spec.timeout_s if spec.timeout_s is not None else tr.TOOL_TIMEOUT_S
        if legacy != effective:
            mismatched[name] = {"legacy": legacy, "registry": effective}
    assert not mismatched, (
        f"registry would change effective timeouts: {mismatched}\n"
        "Raise a TIMEOUTS entry deliberately and above TOOL_TIMEOUT_S, or "
        "leave the tool on the default — but never tighten one by accident."
    )


def test_no_timeout_override_is_secretly_a_cut():
    """A TIMEOUTS entry below the default is a cut wearing a bump's name."""
    from tool_registry.spec import TIMEOUTS

    cuts = {n: v for n, v in TIMEOUTS.items() if v <= tr.TOOL_TIMEOUT_S}
    assert not cuts, (
        f"TIMEOUTS entries at or below the {tr.TOOL_TIMEOUT_S}s default: {cuts} — "
        "an override exists to give a tool MORE room; drop the entry instead."
    )


def test_timeout_overrides_name_real_tools():
    """The bug that made the legacy table dead: keys matching no handler."""
    from tool_registry.spec import TIMEOUTS

    phantom = sorted(set(TIMEOUTS) - set(LEGACY_HANDLERS))
    assert not phantom, f"TIMEOUTS keys with no such tool: {phantom}"


def test_families_partition_the_arsenal():
    """Each tool belongs to exactly one family — no duplicates, no gaps."""
    from tool_registry.families import ALL_TOOLS

    names = [s.name for s in ALL_TOOLS]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    assert not duplicates, f"tool declared in two families: {duplicates}"
    assert len(names) == len(LEGACY_HANDLERS)
