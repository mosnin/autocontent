"""Recall routes (docs/memory/supermemory.md) over the full app and policy,
against a fake Supermemory server. Isolation is the point:

- person A can never read or forget person B's personal memory, by any route;
- an owner or admin can't read a member's personal memory;
- an analyst can't forget team memory;
- the agent and personal access tokens can't use the personal routes;
- only security:manage changes the setting; turning it off stops reads and
  can queue deletion of every namespace;
- the agent learns the setting at session start, and only a verified person
  gets personal recall.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from marketer.recall import repo as recall_repo
from marketer.recall import service as recall_service
from marketer.recall.namespace import derive
from marketer.recall.repo import Setting
from marketer.services.supermemory import SupermemoryClient, reset_breaker
from tests.auth_helpers import DEFAULT_TENANT, as_role
from tests.supermemory_fake import TEST_SECRET, FakeSupermemory, fake_config, set_env

ALICE, BOB = "usr_alice", "usr_bob"
NS_ALICE = derive("personal", DEFAULT_TENANT, ALICE, TEST_SECRET)
NS_BOB = derive("personal", DEFAULT_TENANT, BOB, TEST_SECRET)
NS_TEAM = derive("team", DEFAULT_TENANT, None, TEST_SECRET)


@pytest.fixture
def audit_rows(monkeypatch):
    from marketer.repos import security_audit

    rows: list[dict] = []

    async def _insert(**kw):
        rows.append(kw)
        return len(rows)

    monkeypatch.setattr(security_audit, "insert", _insert)
    return rows


@pytest.fixture
def fake(monkeypatch):
    f = FakeSupermemory()
    set_env(monkeypatch)
    reset_breaker()
    monkeypatch.setattr(recall_service, "client", lambda: SupermemoryClient(fake_config(), transport=f.transport()))
    return f


@pytest.fixture
def state(monkeypatch):
    """The Postgres side, in memory."""
    st = {"enabled": True, "subjects": set(), "queue": [], "fail": False}

    async def get_setting(tenant_id):
        if st["fail"]:
            raise RuntimeError("db down")
        return Setting(st["enabled"] and tenant_id == DEFAULT_TENANT, datetime(2026, 11, 1, tzinfo=timezone.utc))

    async def set_setting(tenant_id, enabled):
        st["enabled"] = enabled
        return Setting(enabled, datetime(2026, 11, 2, tzinfo=timezone.utc))

    async def register_subject(tenant_id, person_id, org_id):
        st["subjects"].add((tenant_id, person_id))

    async def subjects_for_tenant(tenant_id):
        return [p for t, p in st["subjects"] if t == tenant_id]

    async def enqueue(kind, tenant_id, person_id, reason):
        row = (kind, tenant_id, person_id)
        if row in [q[:3] for q in st["queue"]]:
            return False
        st["queue"].append((*row, reason))
        return True

    async def mirror_state(tenant_id):
        return {}

    async def governed_sources(tenant_id, **kw):
        return {}

    for name, fn in dict(get_setting=get_setting, set_setting=set_setting, register_subject=register_subject,
                         subjects_for_tenant=subjects_for_tenant, enqueue=enqueue, mirror_state=mirror_state,
                         governed_sources=governed_sources).items():
        monkeypatch.setattr(recall_repo, name, fn)
    return st


@pytest.fixture
def app(monkeypatch, audit_rows, fake, state):
    from marketer.config import settings

    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "auth_database_url", "")
    from backend.main import create_app
    from backend.rate_limit import limiter

    monkeypatch.setattr(limiter, "enabled", False)
    a = create_app()
    yield a
    a.dependency_overrides.clear()


def _c(app) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def _as(app, role: str, actor: str, **kw):
    as_role(app, role, actor_id=actor, **kw)
    return _c(app)


# --------------------------------------------------------------------------- personal isolation


def test_personal_list_shows_only_my_namespace(app, fake):
    fake.seed(NS_ALICE, "Alice prefers short captions")
    fake.seed(NS_BOB, "Bob is planning a launch in March")
    r = _as(app, "marketer", ALICE).get("/api/v1/memory/personal")
    assert r.status_code == 200, r.text
    assert [i["memory"] for i in r.json()["items"]] == ["Alice prefers short captions"]
    assert all(NS_BOB not in p for p in fake.paths())


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_an_admin_cannot_read_a_members_personal_memory(app, fake, role):
    fake.seed(NS_BOB, "Bob is planning a launch in March")
    c = _as(app, role, ALICE)
    for r in (c.get("/api/v1/memory/personal"), c.get(f"/api/v1/memory/personal?person_id={BOB}"),
              c.get(f"/api/v1/memory/personal?namespace={NS_BOB}"), c.get("/api/v1/memory/personal/export")):
        assert r.status_code == 200
        assert "Bob" not in r.text
    assert all(NS_BOB not in p for p in fake.paths())


def test_person_a_cannot_forget_person_b(app, fake):
    bob_mem = fake.seed(NS_BOB, "Bob is planning a launch in March")
    c = _as(app, "owner", ALICE)
    r = c.post("/api/v1/memory/personal/forget", json={"ids": [bob_mem], "namespace": NS_BOB, "person_id": BOB})
    assert r.status_code == 200, r.text
    assert r.json() == {"forgotten": 0, "failed": 1}
    assert fake.texts(NS_BOB) == ["Bob is planning a launch in March"]
    # The call went to Alice's namespace only.
    assert all(NS_BOB not in p for p in fake.paths())
    preview = c.post("/api/v1/memory/personal/forget/preview", json={"query": "launch March"})
    assert preview.json() == {"matches": []}


def test_forget_flow_preview_then_ids_and_audit(app, fake, audit_rows):
    keep = fake.seed(NS_ALICE, "Alice likes blue")
    drop = fake.seed(NS_ALICE, "Alice moved to Berlin last year")
    c = _as(app, "analyst", ALICE)
    preview = c.post("/api/v1/memory/personal/forget/preview", json={"query": "Berlin"})
    assert [m["id"] for m in preview.json()["matches"]] == [drop]
    assert fake.texts(NS_ALICE) == ["Alice likes blue", "Alice moved to Berlin last year"]  # dry run changed nothing
    r = c.post("/api/v1/memory/personal/forget", json={"ids": [drop]})
    assert r.json() == {"forgotten": 1, "failed": 0}
    assert fake.texts(NS_ALICE) == ["Alice likes blue"] and keep
    row = [a for a in audit_rows if a["action"] == "memory.forget"][-1]
    assert row["metadata"] == {"kind": "personal", "count": 1, "failed": 0}
    assert "Berlin" not in str(row)
    # No retries on deletes: exactly one DELETE /memories.
    assert sum(1 for p in fake.paths() if p.endswith("/memories")) == 1


def test_billing_reads_their_own_personal_memory(app, fake):
    fake.seed(derive("personal", DEFAULT_TENANT, "usr_bill", TEST_SECRET), "Bill wants invoices on Fridays")
    r = _as(app, "billing", "usr_bill").get("/api/v1/memory/personal")
    assert r.status_code == 200 and r.json()["items"][0]["memory"].startswith("Bill")


def test_agent_and_tokens_cannot_use_personal_routes(app, fake):
    fake.seed(NS_ALICE, "Alice prefers short captions")
    agent = _c(app)
    as_role(app, "agent", actor_role="owner", actor_id=ALICE)
    assert agent.get("/api/v1/memory/personal").status_code == 403
    assert agent.post("/api/v1/memory/personal/forget", json={"ids": ["mem_1"]}).status_code == 403
    token = _as(app, "owner", ALICE, actor_type="token")
    assert token.get("/api/v1/memory/personal").status_code == 403
    assert token.get("/api/v1/memory/personal/export").status_code == 403
    assert fake.requests == []


def test_bad_ids_are_refused(app, fake):
    c = _as(app, "owner", ALICE)
    assert c.post("/api/v1/memory/personal/forget", json={"ids": ["../../x"]}).status_code == 422
    assert c.post("/api/v1/memory/personal/forget", json={"ids": []}).status_code == 422
    assert fake.requests == []


# --------------------------------------------------------------------------- team


def test_team_list_and_forget_permissions(app, fake, audit_rows):
    mem = fake.seed(NS_TEAM, "Confirmed fact about brand Pasta Club: voice = warm")
    analyst = _as(app, "analyst", ALICE)
    assert analyst.get("/api/v1/memory/team").json()["items"][0]["id"] == mem
    r = analyst.post("/api/v1/memory/team/forget", json={"ids": [mem]})
    assert r.status_code == 403 and r.json()["permission"] == "memory:forget"
    assert analyst.post("/api/v1/memory/team/forget/preview", json={"query": "voice"}).status_code == 403
    marketer = _as(app, "marketer", ALICE)
    assert marketer.post("/api/v1/memory/team/forget", json={"ids": [mem]}).status_code == 403
    billing = _as(app, "billing", ALICE)
    assert billing.get("/api/v1/memory/team").status_code == 403
    assert fake.texts(NS_TEAM) == ["Confirmed fact about brand Pasta Club: voice = warm"]
    admin = _as(app, "admin", ALICE)
    assert admin.post("/api/v1/memory/team/forget", json={"ids": [mem]}).json() == {"forgotten": 1, "failed": 0}
    assert fake.texts(NS_TEAM) == []


def test_agent_cannot_forget_team(app, fake):
    agent = _c(app)
    as_role(app, "agent", actor_role="owner", actor_id=ALICE)
    assert agent.post("/api/v1/memory/team/forget", json={"ids": ["mem_1"]}).status_code == 403
    assert fake.requests == []


# --------------------------------------------------------------------------- the setting


def test_only_security_manage_changes_the_setting(app, state, audit_rows):
    for role in ("marketer", "analyst", "billing"):
        r = _as(app, role, ALICE).put("/api/v1/memory/recall/settings", json={"enabled": False})
        assert r.status_code == 403 and r.json()["permission"] == "security:manage"
    assert state["enabled"] is True
    agent = _c(app)
    as_role(app, "agent", actor_role="owner", actor_id=ALICE)
    assert agent.put("/api/v1/memory/recall/settings", json={"enabled": False}).status_code == 403
    r = _as(app, "admin", ALICE).put("/api/v1/memory/recall/settings", json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert any(a["action"] == "memory.recall_setting" for a in audit_rows)
    # Every member can read it.
    assert _as(app, "billing", ALICE).get("/api/v1/memory/recall/settings").json()["enabled"] is False


def test_off_switch_stops_reads_and_can_delete_everything(app, fake, state):
    fake.seed(NS_ALICE, "Alice prefers short captions")
    fake.seed(NS_TEAM, "Brand kit")
    state["subjects"] |= {(DEFAULT_TENANT, ALICE), (DEFAULT_TENANT, BOB)}
    admin = _as(app, "owner", ALICE)
    r = admin.put("/api/v1/memory/recall/settings", json={"enabled": False, "delete_data": True})
    assert r.json()["queued_deletes"] == 3
    assert sorted(q[:3] for q in state["queue"]) == sorted([("team", DEFAULT_TENANT, None), ("personal", DEFAULT_TENANT, ALICE), ("personal", DEFAULT_TENANT, BOB)])
    before = len(fake.requests)
    assert admin.get("/api/v1/memory/personal").json() == {"enabled": False, "items": [], "total": 0, "page": 1}
    assert admin.get("/api/v1/memory/team").json()["enabled"] is False
    assert len(fake.requests) == before
    # Forgetting is never blocked by the switch.
    mem = next(iter(fake.ns[NS_ALICE].memories))
    assert admin.post("/api/v1/memory/personal/forget", json={"ids": [mem]}).json()["forgotten"] == 1


def test_enable_refused_when_not_configured(app, monkeypatch):
    monkeypatch.delenv("SUPERMEMORY_API_KEY")
    r = _as(app, "owner", ALICE).put("/api/v1/memory/recall/settings", json={"enabled": True})
    assert r.status_code == 409


def test_setting_unreadable_is_503_not_on(app, state):
    state["fail"] = True
    assert _as(app, "owner", ALICE).get("/api/v1/memory/personal").status_code == 503


# --------------------------------------------------------------------------- agent session


def test_agent_session_registers_only_a_verified_person(app, state):
    c = _c(app)
    as_role(app, "agent", actor_role="marketer", actor_id=ALICE)
    assert c.get("/api/v1/memory/recall/session").json() == {"enabled": True, "personal": True}
    assert state["subjects"] == {(DEFAULT_TENANT, ALICE)}
    as_role(app, "agent")  # background: no verified person
    assert c.get("/api/v1/memory/recall/session").json() == {"enabled": True, "personal": False}
    assert state["subjects"] == {(DEFAULT_TENANT, ALICE)}
    state["enabled"] = False
    as_role(app, "agent", actor_role="marketer", actor_id=BOB)
    assert c.get("/api/v1/memory/recall/session").json() == {"enabled": False, "personal": False}
    assert (DEFAULT_TENANT, BOB) not in state["subjects"]


def test_session_route_is_agent_only(app):
    assert _as(app, "owner", ALICE).get("/api/v1/memory/recall/session").status_code == 403
    # billing has no agent:chat; analyst does but is not the agent.
    assert _as(app, "analyst", ALICE).get("/api/v1/memory/recall/session").status_code == 403


def test_session_route_fails_closed(app, state):
    state["fail"] = True
    c = _c(app)
    as_role(app, "agent", actor_role="owner", actor_id=ALICE)
    assert c.get("/api/v1/memory/recall/session").status_code == 503
