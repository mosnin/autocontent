"""Route permissions by role, through the real app and the one enforcement
point (backend/policy.py). Allowed means the policy let the request through
(the handler then answers, here usually 422 for a deliberately invalid body);
denied means 403 {"detail": "forbidden", "permission": ...} and a
permission.denied row in the security audit log."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.models import Niche, PostingWindow, User
from tests.auth_helpers import DEFAULT_ACTOR, DEFAULT_ORG, DEFAULT_TENANT, as_role

ROLES = ("owner", "admin", "marketer", "analyst", "billing")
NICHE_ID = UUID("33333333-3333-3333-3333-333333333333")
SOME_ID = "44444444-4444-4444-4444-444444444444"


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
def app(monkeypatch, audit_rows):
    from marketer.config import settings

    # No route here may reach a real database.
    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "auth_database_url", "")
    from backend.main import create_app

    a = create_app()
    yield a
    a.dependency_overrides.clear()


def _client(app) -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def _denied(r, permission: str) -> None:
    assert r.status_code == 403, r.text
    assert r.json() == {"detail": "forbidden", "permission": permission}


def _allowed(r) -> None:
    assert r.status_code != 403, r.text


# (method, path, permission) whose handler validates a JSON object body: a list
# body is a 422 once the policy lets the request through.
BODY_ROUTES = [
    ("POST", "/api/v1/niches", "playbook:create"),
    ("POST", "/api/v1/jobs", "content:create"),
    ("POST", "/api/v1/tokens", "api_token:create"),
    ("POST", "/api/v1/billing/checkout", "billing:manage"),
    ("PATCH", f"/api/v1/ads/accounts/{SOME_ID}/governance", "spend:set_limits"),
    ("POST", f"/api/v1/ads/approvals/{SOME_ID}/decide", "spend:approve"),
    ("PUT", "/api/v1/brand-kit", "brand:update"),
    ("POST", "/api/v1/webhook-endpoints", "webhook:manage"),
    ("POST", "/api/v1/ads/accounts/connect", "integration:connect"),
    ("POST", "/api/v1/campaigns", "campaign:create"),
    ("POST", f"/api/v1/memory/facts/{SOME_ID}/correct", "memory:confirm"),
]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("method,path,permission", BODY_ROUTES)
def test_role_matrix_on_representative_routes(app, audit_rows, role, method, path, permission):
    from backend import permissions as perms

    as_role(app, role)
    r = _client(app).request(method, path, json=[])
    if permission in perms.permissions_for(role):
        _allowed(r)
        assert r.status_code == 422
    else:
        _denied(r, permission)
        [row] = audit_rows
        assert row["action"] == "permission.denied"
        assert row["outcome"] == "denied"
        assert row["metadata"]["permission"] == permission
        assert row["metadata"]["role"] == role
        assert row["tenant_id"] == DEFAULT_TENANT
        assert row["org_id"] == DEFAULT_ORG
        assert row["actor_id"] == DEFAULT_ACTOR
        assert row["actor_type"] == "user"
        assert row["target_id"] == f"{method} {path}"


def test_expected_shape_of_the_matrix():
    """Spot checks that read like the product, so a catalog edit that changes
    them is noticed."""
    from backend import permissions as perms

    def can(role, p):
        return p in perms.permissions_for(role)

    assert can("marketer", "campaign:launch") and not can("marketer", "spend:set_limits")
    assert can("analyst", "content:read") and not can("analyst", "content:approve")
    assert can("billing", "billing:manage") and not can("billing", "content:read")
    assert can("admin", "api_token:create") and not can("admin", "workspace:delete")
    assert can("owner", "workspace:delete")


@pytest.mark.parametrize("role", ROLES)
def test_reading_content_needs_content_read(app, monkeypatch, role):
    from marketer.repos import jobs as jobs_repo

    async def _list(*a, **k):
        return []

    monkeypatch.setattr(jobs_repo, "list_for_user", _list, raising=False)
    as_role(app, role)
    r = _client(app).get("/api/v1/calendar?start=2026-01-01&end=2026-01-02")
    if role == "billing":
        _denied(r, "content:read")
    else:
        _allowed(r)


@pytest.mark.parametrize("role", ROLES)
def test_profile_is_open_to_every_member(app, monkeypatch, role):
    from marketer.repos import users as users_repo

    async def _ensure(tenant_id, email):
        return User(id=tenant_id, email="owner@t.com")

    monkeypatch.setattr(users_repo, "ensure", _ensure)
    as_role(app, role)
    r = _client(app).get("/api/v1/users/me")
    assert r.status_code == 200
    assert r.json()["id"] == DEFAULT_TENANT


@pytest.mark.parametrize("role", ["admin", "marketer", "analyst", "billing"])
def test_only_the_owner_erases_or_exports(app, monkeypatch, role):
    from marketer.repos import privacy

    async def _boom(*_a):
        raise AssertionError("must not be reached")

    monkeypatch.setattr(privacy, "erase_user", _boom)
    monkeypatch.setattr(privacy, "export_user", _boom)
    as_role(app, role)
    c = _client(app)
    _denied(c.delete("/api/v1/users/me"), "workspace:delete")
    _denied(c.get("/api/v1/users/me/export"), "workspace:delete")


def test_owner_can_erase(app, monkeypatch):
    from marketer.repos import privacy

    erased: list[str] = []

    async def _erase(uid):
        erased.append(uid)

    monkeypatch.setattr(privacy, "erase_user", _erase)
    as_role(app, "owner")
    assert _client(app).delete("/api/v1/users/me").status_code == 204
    assert erased == [DEFAULT_TENANT]


def test_workspace_owner_is_not_a_platform_admin(app):
    as_role(app, "owner")
    r = _client(app).get("/api/v1/admin/overview", headers={"Authorization": "Bearer mkt_x"})
    assert r.status_code == 403
    r = _client(app).get("/api/v1/ops/metrics")
    assert r.status_code == 401


def test_public_routes_need_no_auth(app):
    r = _client(app).get("/healthz")
    assert r.status_code == 200


def test_unauthenticated_request_is_401(app):
    assert _client(app).get("/api/v1/jobs").status_code == 401


# --------------------------------------------------------------------------- audit robustness


def test_audit_failure_never_turns_a_deny_into_an_allow(app, monkeypatch):
    from marketer.repos import security_audit

    async def _down(**kw):
        raise OSError("db down")

    monkeypatch.setattr(security_audit, "insert", _down)
    as_role(app, "analyst")
    _denied(_client(app).post("/api/v1/jobs", json=[]), "content:create")


def test_a_slow_audit_write_does_not_hold_the_response(app, monkeypatch):
    from backend import audit
    from marketer.repos import security_audit

    monkeypatch.setattr(audit, "AUDIT_TIMEOUT_SEC", 0.2)

    async def _slow(**kw):
        await asyncio.sleep(5)

    monkeypatch.setattr(security_audit, "insert", _slow)
    as_role(app, "analyst")
    t0 = time.monotonic()
    _denied(_client(app).post("/api/v1/jobs", json=[]), "content:create")
    assert time.monotonic() - t0 < 2


# --------------------------------------------------------------------------- in-route checks


def test_ads_status_needs_launch_to_go_live_and_pause_to_stop(app, audit_rows):
    c = _client(app)
    # The agent with no verified person may pause, never launch.
    as_role(app, "agent")
    r = c.post(f"/api/v1/ads/campaigns/{SOME_ID}/status", json={"status": "active"})
    _denied(r, "campaign:launch")
    assert audit_rows[-1]["actor_type"] == "agent"
    assert audit_rows[-1]["metadata"]["delegated"] is True
    # An analyst can do neither.
    as_role(app, "analyst")
    _denied(c.post(f"/api/v1/ads/campaigns/{SOME_ID}/status", json={"status": "paused"}), "campaign:launch")


def test_ads_status_pause_passes_the_check(app, monkeypatch):
    from marketer.repos import ads as ads_repo

    async def _none(*a, **k):
        return None

    monkeypatch.setattr(ads_repo, "get_campaign", _none)
    as_role(app, "agent")
    r = _client(app).post(f"/api/v1/ads/campaigns/{SOME_ID}/status", json={"status": "paused"})
    assert r.status_code == 404  # past the permission check, campaign not found


@pytest.fixture
def decided(monkeypatch):
    from backend.routes import ads as ads_routes
    from backend.routes import jobs as jobs_routes
    from marketer.repos import ad_approvals

    calls: list[str] = []

    async def _approve(item_id, ctx):
        calls.append("video")

    async def _ad(item_id, decision, ctx):
        calls.append("ad")

    async def _get(item_id, *, user_id):
        return object()

    monkeypatch.setattr(jobs_routes, "approve_job", _approve)
    monkeypatch.setattr(ads_routes, "decide_ad_approval", _ad)
    monkeypatch.setattr(ad_approvals, "get", _get)
    return calls


def test_inbox_decide_permission_depends_on_kind(app, decided):
    c = _client(app)
    body = {"decision": "approve"}
    as_role(app, "agent")  # no verified person: content:approve yes, spend:approve no
    assert c.post(f"/api/v1/workspace/inbox/video/{SOME_ID}/decide", json=body).status_code == 200
    _denied(c.post(f"/api/v1/workspace/inbox/ad_change/{SOME_ID}/decide", json=body), "spend:approve")
    assert decided == ["video"]

    as_role(app, "agent", actor_role="marketer")
    assert c.post(f"/api/v1/workspace/inbox/ad_change/{SOME_ID}/decide", json=body).status_code == 200
    assert decided == ["video", "ad"]

    for role in ("analyst", "billing"):
        as_role(app, role)
        _denied(c.post(f"/api/v1/workspace/inbox/video/{SOME_ID}/decide", json=body), "content:approve")
    assert decided == ["video", "ad"]


def test_resolving_an_unknown_outcome_needs_the_matching_permission(app, rails_store):
    eid = uuid4()
    rails_store.rows[eid] = _row(eid, "ads.budget.change")
    content = uuid4()
    rails_store.rows[content] = _row(content, "content.post.send")
    as_role(app, "marketer", permissions=frozenset({"content:publish"}))
    r = _client(app).post(f"/api/v1/workspace/required-actions/{eid}/resolve", json={"resolution": "confirmed_succeeded"})
    _denied(r, "spend:approve")
    as_role(app, "analyst")
    r = _client(app).post(f"/api/v1/workspace/required-actions/{eid}/resolve", json={"resolution": "confirmed_succeeded"})
    _denied(r, "content:publish")


def _row(eid, action):
    from dataclasses import fields

    from marketer.rails.store import ExecutionRow

    values = {f.name: None for f in fields(ExecutionRow)}
    values.update(
        id=eid, user_id=DEFAULT_TENANT, action=action, tier="CRITICAL",
        principal="user", args_hash="h", target_type="ad_campaign", target_id="c",
        outcome="indeterminate", detail={}, error="", resolved_by="",
    )
    return ExecutionRow(**values)


def test_account_settings_need_the_permission_for_each_field(app, monkeypatch):
    from marketer.repos import users as users_repo

    written: list[dict] = []

    async def _update(uid, **kw):
        written.append(kw)
        return User(id=uid, email="o@t.com")

    monkeypatch.setattr(users_repo, "update_settings", _update)
    c = _client(app)
    as_role(app, "billing")
    _denied(c.patch("/api/v1/users/me", json={"email_notifications": False}), "spend:set_limits")
    as_role(app, "marketer")
    _denied(c.patch("/api/v1/users/me", json={"email_notifications": False}), "spend:set_limits")
    as_role(app, "admin")
    assert c.patch("/api/v1/users/me", json={"email_notifications": False}).status_code == 200
    assert written == [{"email_notifications": False}]


def _niche(**over) -> Niche:
    base = dict(
        id=NICHE_ID, user_id=DEFAULT_TENANT, title="Cooking", description="d",
        target_audience="a", hashtags=["#x"], visual_style="v", voice="warm",
        target_duration_sec=30, scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")], platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"), approve_before_post=True,
        created_at=datetime.now(timezone.utc),
    )
    base.update(over)
    return Niche(**base)


def test_playbook_caps_need_set_limits_and_the_gate_needs_approve(app, monkeypatch):
    from marketer.repos import niches as niches_repo

    state = {"niche": _niche()}

    async def _get(niche_id, *, user_id):
        return state["niche"] if user_id == DEFAULT_TENANT else None

    async def _update(niche_id, *, user_id, **fields):
        state["niche"] = state["niche"].model_copy(update=fields)
        return state["niche"]

    monkeypatch.setattr(niches_repo, "get", _get)
    monkeypatch.setattr(niches_repo, "update", _update)
    c = _client(app)
    url = f"/api/v1/niches/{NICHE_ID}"

    as_role(app, "marketer")
    _denied(c.put(url, json={"daily_spend_cap_usd": "9.00"}), "spend:set_limits")
    assert state["niche"].daily_spend_cap_usd == Decimal("5.00")
    # Renaming is plain playbook:update.
    assert c.put(url, json={"title": "Baking"}).status_code == 200

    as_role(app, "admin")
    assert c.put(url, json={"daily_spend_cap_usd": "9.00"}).status_code == 200

    as_role(app, "analyst")
    _denied(c.put(url, json={"title": "x"}), "playbook:update")


def test_memory_writes_person_needs_confirm_agent_needs_chat(app, monkeypatch):
    from marketer.repos import memory as memory_repo

    async def _write(user_id, fact, *, actor):
        raise AssertionError("not reached in the denied cases")

    monkeypatch.setattr(memory_repo, "write_fact", _write)
    c = _client(app)
    body = {"subject": {"type": "brand", "name": "Acme"}, "predicate": "voice", "value": "warm"}
    as_role(app, "analyst")
    _denied(c.post("/api/v1/memory/facts", json=body), "memory:confirm")
    as_role(app, "billing")
    _denied(c.post("/api/v1/memory/facts", json=body), "memory:confirm")
    as_role(app, "agent", actor_role="billing")  # agent ∩ billing has no agent:chat
    _denied(c.post("/api/v1/memory/facts", json=body), "memory:confirm")


# --------------------------------------------------------------------------- delegation over HTTP


def test_agent_is_capped_by_the_actor(app):
    c = _client(app)
    as_role(app, "agent", actor_role="analyst")
    _denied(c.post("/api/v1/jobs", json=[]), "content:create")
    as_role(app, "agent", actor_role="marketer")
    assert c.post("/api/v1/jobs", json=[]).status_code == 422
    as_role(app, "agent", actor_role="owner")
    # The agent never reaches tokens or erasure, whoever started it.
    _denied(c.post("/api/v1/tokens", json={"name": "x"}), "api_token:create")
    _denied(c.delete("/api/v1/users/me"), "workspace:delete")


def test_agent_without_actor_cannot_move_money(app):
    c = _client(app)
    as_role(app, "agent")
    _denied(c.post(f"/api/v1/ads/approvals/{SOME_ID}/decide", json={"decision": "approved"}), "spend:approve")
    _denied(c.post(f"/api/v1/campaigns/{SOME_ID}/start"), "campaign:launch")


# --------------------------------------------------------------------------- tokens


@pytest.fixture
def tokens(monkeypatch):
    from marketer.models import PersonalAccessToken
    from marketer.repos import tokens as tokens_repo

    made: list[dict] = []
    revoked: list[UUID] = []

    async def _create(*, user_id, name, expires_at, role, created_by):
        made.append(dict(user_id=user_id, name=name, role=role, created_by=created_by))
        return PersonalAccessToken(
            id=uuid4(), user_id=user_id, name=name, prefix="mkt_abcd",
            created_at=datetime.now(timezone.utc), role=role, created_by=created_by,
        ), "mkt_" + "a" * 24

    async def _revoke(token_id, user_id):
        revoked.append(token_id)
        return True

    monkeypatch.setattr(tokens_repo, "create", _create)
    monkeypatch.setattr(tokens_repo, "revoke", _revoke)
    return made, revoked


def test_token_role_ceiling(app, tokens, audit_rows):
    made, _ = tokens
    c = _client(app)
    as_role(app, "admin")
    r = c.post("/api/v1/tokens", json={"name": "ci", "role": "owner"})
    assert r.status_code == 403 and "at most your own role" in r.json()["detail"]
    assert made == []
    assert audit_rows[-1]["action"] == "api_token.create"
    assert audit_rows[-1]["outcome"] == "denied"

    for role in ("admin", "marketer", "analyst", "billing"):
        r = c.post("/api/v1/tokens", json={"name": "ci", "role": role})
        assert r.status_code == 201, r.text
        assert r.json()["info"]["role"] == role
    r = c.post("/api/v1/tokens", json={"name": "ci", "role": "agent"})
    assert r.status_code == 403  # never assignable

    as_role(app, "owner")
    assert c.post("/api/v1/tokens", json={"name": "ci", "role": "owner"}).status_code == 201


def test_token_defaults_to_creator_role_and_records_creator(app, tokens, audit_rows):
    made, _ = tokens
    as_role(app, "admin")
    r = _client(app).post("/api/v1/tokens", json={"name": "ci"})
    assert r.status_code == 201
    assert made[-1] == {"user_id": DEFAULT_TENANT, "name": "ci", "role": "admin", "created_by": DEFAULT_ACTOR}
    row = audit_rows[-1]
    assert row["action"] == "api_token.created" and row["outcome"] == "success"
    assert row["target_type"] == "api_token"
    assert row["metadata"]["role"] == "admin"
    assert "mkt_" + "a" * 24 not in str(row)  # never the secret


def test_token_revocation_is_audited(app, tokens, audit_rows):
    _, revoked = tokens
    as_role(app, "admin")
    tid = uuid4()
    assert _client(app).delete(f"/api/v1/tokens/{tid}").status_code == 204
    assert revoked == [tid]
    assert audit_rows[-1]["action"] == "api_token.revoked"
    assert audit_rows[-1]["target_id"] == str(tid)


def test_a_token_mints_at_most_its_own_role(app, tokens):
    as_role(app, "marketer", actor_type="token",
            permissions=frozenset({"api_token:create", "api_token:read"}))
    r = _client(app).post("/api/v1/tokens", json={"name": "ci", "role": "admin"})
    assert r.status_code == 403


# --------------------------------------------------------------------------- audit log route


def test_audit_log_lists_only_the_callers_workspace(app, monkeypatch):
    from marketer.repos import security_audit
    from marketer.repos.security_audit import SecurityAuditEntry

    seen: list[tuple] = []

    async def _list(org_id, tenant_id, *, limit, before_id):
        seen.append((org_id, tenant_id, limit, before_id))
        return [
            SecurityAuditEntry(id=i, at=datetime.now(timezone.utc), actor_type="user",
                               action="auth.sign_in", outcome="success", org_id=org_id)
            for i in range(limit, 0, -1)
        ]

    monkeypatch.setattr(security_audit, "list_for_org", _list)
    c = _client(app)
    as_role(app, "admin")
    r = c.get("/api/v1/audit-log?limit=2&before=99")
    assert r.status_code == 200
    assert seen == [(DEFAULT_ORG, DEFAULT_TENANT, 2, 99)]
    assert r.json()["next_before"] == 1
    assert c.get("/api/v1/audit-log?limit=500").status_code == 422  # bounded
    for role in ("marketer", "analyst", "billing"):
        as_role(app, role)
        _denied(c.get("/api/v1/audit-log"), "audit:read")
