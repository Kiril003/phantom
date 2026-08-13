"""Every user id must map to a name ChromaDB will actually accept.

`_collection_name` enforced Chroma's character-set and length rules but not its
"must start and end with an alphanumeric character" rule. An id ending in `_` or
`-` therefore produced an invalid name — `__system__` became
`phantom_v1_episodes___system__` — and Chroma rejected the collection. The
episodic writer logs that as "non-fatal", so system memory was silently never
recorded rather than erroring.

`__system__` was not hypothetical: it used to be the default actor of
`agent.kernel.audit.write_memory_seed` and a hardcoded user id in
`agent/operations/safety/resource_gate.py`. Both are gone now — there is no
`__system__` user row and the FK would reject one — but the sanitiser still
has to hold for ANY id, so these cases stay as the regression corpus.
"""
from __future__ import annotations

import re

import pytest

from agent.cognition.memory.embedder import _collection_name

# Chroma's documented constraint: 3-63 chars, starts and ends alphanumeric,
# otherwise alphanumerics/underscore/hyphen, and no consecutive periods.
_CHROMA_NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{1,61}[a-zA-Z0-9]$")


def _assert_valid(name: str, source: str) -> None:
    assert 3 <= len(name) <= 63, f"{source!r} -> {name!r} has invalid length"
    assert _CHROMA_NAME.match(name), f"{source!r} -> {name!r} rejected by Chroma"
    assert ".." not in name, f"{source!r} -> {name!r} has consecutive periods"


@pytest.mark.parametrize(
    "user_id",
    [
        "__system__",        # the original regression (former default actor)
        "trailing_",
        "trailing-",
        "_leading",
        "-leading",
        "abc",
        "backfill-user",
        "x",
        "a" * 80,            # over the length budget
        "ünïcode",           # stripped to nothing recognisable
        "..dots..",
        "!!!",               # empty after sanitisation
        "550e8400-e29b-41d4-a716-446655440000",  # ordinary uuid4
    ],
)
def test_every_user_id_yields_a_name_chroma_accepts(user_id):
    _assert_valid(_collection_name(user_id), user_id)


def test_none_and_empty_fall_back_to_a_valid_default():
    _assert_valid(_collection_name(None), "None")
    _assert_valid(_collection_name(""), "")


def test_distinct_users_never_share_a_collection():
    """Collision would be a cross-user memory leak, not just a naming bug."""
    ids = ["__system__", "trailing_", "trailing-", "a" * 80, "b" * 80, "!!!", "ünïcode"]
    names = [_collection_name(i) for i in ids]
    assert len(set(names)) == len(names), f"collision among {names}"


def test_plain_ids_keep_their_readable_name():
    """The hash suffix is for ids that need it — ordinary ones stay greppable."""
    assert _collection_name("abc") == "phantom_v1_episodes_abc"
    assert _collection_name("backfill-user") == "phantom_v1_episodes_backfill-user"


def test_configured_prefix_is_actually_honoured(monkeypatch):
    """`agent_episodic_collection` read nothing for an entire release.

    Two consequences: an operator could set it and silently get no effect, and
    the `isolated_collection` test fixture that monkeypatches it produced no
    isolation — every "isolated" test shared one collection, which is why this
    module's tests passed alone and failed in a full suite run.
    """
    from config import config

    monkeypatch.setattr(config, "agent_episodic_collection", "custom_ns")
    name = _collection_name("abc")
    assert name == "custom_ns_abc", f"configured prefix ignored: {name}"
    _assert_valid(name, "abc")


def test_default_prefix_preserves_existing_collections():
    """The default must stay the historical hardcoded value.

    Changing it silently repoints every deployment at empty collections.
    """
    from config import config

    assert config.agent_episodic_collection == "phantom_v1_episodes"


def test_a_hostile_prefix_cannot_produce_an_invalid_name(monkeypatch):
    from config import config

    for hostile in ["", "   ", "!!!", "_leading_", "-x-", "a" * 80]:
        monkeypatch.setattr(config, "agent_episodic_collection", hostile)
        _assert_valid(_collection_name("__system__"), f"prefix={hostile!r}")
        _assert_valid(_collection_name("abc"), f"prefix={hostile!r}")
