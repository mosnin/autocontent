"""Namespace derivation (docs/memory/supermemory.md): the shared vectors, the
refusals, and the guard that nothing else in the backend builds a namespace or
a ``/ns/`` path."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from marketer.recall.namespace import NamespaceRefused, Scope, derive, scope

ROOT = Path(__file__).resolve().parents[1]
VECTORS = json.loads((ROOT / "docs/memory/supermemory-namespaces.json").read_text())


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: c["message"])
def test_vectors(case):
    kind = "team" if case["kind"] == "team" else "personal"
    got = derive(kind, case["tenant_id"], case.get("person_id"), VECTORS["secret"])
    assert got == case["namespace"]


def test_no_ids_or_secret_in_the_namespace():
    ns = derive("personal", "org_7Hk2", "usr_alice", VECTORS["secret"])
    assert "org_7Hk2" not in ns and "usr_alice" not in ns
    assert re.fullmatch(r"mkt-p-[0-9a-f]{40}", ns)
    assert derive("personal", "org_7Hk2", "usr_alice", "another-secret-0123456789abcdef0123") != ns


@pytest.mark.parametrize(
    "tenant,person",
    [("org|x", "usr"), ("org", "usr|x"), ("", "usr"), ("org", ""), ("org", None), ("org\n", "u"), ("o" * 300, "u")],
)
def test_refuses_bad_ids(tenant, person):
    with pytest.raises(NamespaceRefused):
        derive("personal", tenant, person, VECTORS["secret"])


def test_refuses_team_with_person_and_missing_secret():
    with pytest.raises(NamespaceRefused):
        derive("team", "org", "usr", VECTORS["secret"])
    with pytest.raises(NamespaceRefused):
        derive("team", "org", None, "")


def test_a_pipe_cannot_collide_two_people():
    # Without the refusal, ("a|b","c") and ("a","b|c") would hash the same message.
    with pytest.raises(NamespaceRefused):
        derive("personal", "a|b", "c", VECTORS["secret"])
    with pytest.raises(NamespaceRefused):
        derive("personal", "a", "b|c", VECTORS["secret"])


def test_scope_hides_its_namespace_in_repr():
    s = scope("team", "org_7Hk2", None, VECTORS["secret"])
    assert isinstance(s, Scope) and "mkt-" not in repr(s) and "org_7Hk2" not in repr(s)


def _py_files():
    for base in ("backend", "src/marketer"):
        yield from (ROOT / base).rglob("*.py")


def test_guard_only_one_module_derives_namespaces():
    """Only marketer/recall/namespace.py spells a namespace prefix or calls
    hmac for it; only marketer/services/supermemory.py builds a /ns/ path."""
    derive_ok = {ROOT / "src/marketer/recall/namespace.py"}
    path_ok = {ROOT / "src/marketer/services/supermemory.py"}
    offenders = []
    for f in _py_files():
        text = f.read_text()
        if f not in derive_ok and re.search(r"mkt-[tp]-", text):
            offenders.append(f"{f.relative_to(ROOT)}: namespace prefix")
        if f not in path_ok and re.search(r"""["'/]ns/|/ns/\{|"/ns"|'/ns'""", text):
            offenders.append(f"{f.relative_to(ROOT)}: builds a /ns/ path")
    assert offenders == []


def test_guard_no_route_accepts_a_namespace():
    """No recall route takes a namespace, a person, a tenant or a user id from
    the request (query, path or body): those come from AuthCtx only."""
    from backend.routes import memory

    banned = {"namespace", "ns", "person", "person_id", "actor_id", "tenant_id", "user_id", "member_id", "container_tag", "scope"}
    checked = 0
    for route in memory.router.routes:
        if not any(p in route.path for p in ("/recall", "/personal", "/team")):
            continue
        checked += 1
        d = route.dependant
        names = {p.name for p in d.query_params + d.path_params + d.header_params}
        for b in d.body_params:
            ann = b.field_info.annotation
            names |= set(getattr(ann, "model_fields", {}) or {})
        assert not (names & banned), (route.path, names & banned)
    assert checked >= 10


def test_client_refuses_a_plain_string():
    import asyncio

    from marketer.services.supermemory import SupermemoryClient
    from tests.supermemory_fake import FakeSupermemory, fake_config

    c = SupermemoryClient(fake_config(), transport=FakeSupermemory().transport())
    with pytest.raises(TypeError):
        asyncio.run(c.search("mkt-p-" + "0" * 40, "x"))  # type: ignore[arg-type]
