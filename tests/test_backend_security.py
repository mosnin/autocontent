"""Backend security hardening (docs/security/backend-audit.md).

Each section names the finding it pins. Every fix has its denied path here:
the oversized body, the agent asking for a person-only action, the tenant
reaching for another tenant's row, the replayed webhook, the rebinding DNS
answer. Repos are faked in memory; nothing here needs Postgres or a network.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import sys
import types
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus, Niche, PostingWindow, User
from tests.auth_helpers import ctx_for

USER = "user_sec"
OTHER = "user_other"
H = {"Authorization": "Bearer mkt_x"}
NICHE_ID = UUID("22222222-2222-2222-2222-222222222222")


def _app(monkeypatch, *, user_id: str = USER, delegated: bool = False, role: str = "user"):
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import require_user
    from backend.main import create_app

    async def _fake():
        return ctx_for("owner", user_id=user_id, email="p@t.com", role=role, delegated=delegated)

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return app


def _client(monkeypatch, **kw) -> TestClient:
    return TestClient(_app(monkeypatch, **kw), raise_server_exceptions=False)


def _niche(**over) -> Niche:
    base = dict(
        id=NICHE_ID, user_id=USER, title="Cooking", description="d", target_audience="a",
        hashtags=["#x"], visual_style="v", voice="warm", target_duration_sec=30, scene_count=3,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")], platforms=["tiktok"],
        daily_spend_cap_usd=Decimal("5.00"), approve_before_post=True,
        created_at=datetime.now(timezone.utc),
    )
    base.update(over)
    return Niche(**base)


@pytest.fixture
def niches(monkeypatch):
    """One playbook owned by USER, in memory."""
    from marketer.repos import niches as niches_repo

    state = {"niche": _niche(), "updates": []}

    async def _get(niche_id, *, user_id):
        n = state["niche"]
        return n if (niche_id == n.id and user_id == n.user_id) else None

    async def _update(niche_id, *, user_id, **fields):
        n = await _get(niche_id, user_id=user_id)
        if n is None:
            return None
        state["updates"].append(fields)
        state["niche"] = n.model_copy(update={k: v for k, v in fields.items() if v is not None})
        return state["niche"]

    monkeypatch.setattr(niches_repo, "get", _get)
    monkeypatch.setattr(niches_repo, "update", _update)
    return state


def _outcomes(rails_store) -> list[tuple[str, str | None]]:
    return sorted((r.action, r.outcome) for r in rails_store.rows.values())


# --------------------------------------------------------------------------- body size (M1)


def test_oversized_body_is_refused_before_the_handler(monkeypatch):
    client = _client(monkeypatch)
    big = json.dumps({"description": "x" * (1024 * 1024 + 10)})
    r = client.post("/api/v1/niches/draft", content=big, headers={**H, "content-type": "application/json"})
    assert r.status_code == 413
    assert r.json()["detail"] == "request body too large"


def test_chunked_body_without_content_length_is_cut_off_at_the_limit():
    """A client that omits Content-Length cannot stream past the cap."""
    from backend.security import DEFAULT_MAX_BODY_BYTES, BodySizeLimitMiddleware

    reached = []

    async def app(scope, receive, send):  # pragma: no cover - must not run
        reached.append(True)

    chunk = b"a" * (256 * 1024)
    sent = {"n": 0}

    async def receive():
        sent["n"] += 1
        return {"type": "http.request", "body": chunk, "more_body": True}

    out: list[dict] = []

    async def send(message):
        out.append(message)

    scope = {"type": "http", "method": "POST", "path": "/api/v1/kits", "headers": []}
    asyncio.run(BodySizeLimitMiddleware(app)(scope, receive, send))
    assert not reached
    assert out[0]["status"] == 413
    # Stopped reading as soon as the limit was crossed, not after the stream.
    assert sent["n"] == DEFAULT_MAX_BODY_BYTES // len(chunk) + 1


def test_body_limits_per_route_and_small_bodies_pass(monkeypatch):
    from backend.security import DEFAULT_MAX_BODY_BYTES, body_limit_for

    assert body_limit_for("/api/v1/templates/abc/remix") == 12 * 1024 * 1024
    assert body_limit_for("/api/v1/decisions/log") == 64 * 1024
    assert body_limit_for("/api/v1/niches") == DEFAULT_MAX_BODY_BYTES

    client = _client(monkeypatch)
    # Under the limit: reaches the handler, which validates it (422, not 413).
    r = client.post("/api/v1/niches/draft", json={"description": "tiny"}, headers=H)
    assert r.status_code == 422
    # A lying Content-Length is not a way in either.
    r = client.post(
        "/api/v1/niches/draft", content=b"{}",
        headers={**H, "content-type": "application/json", "content-length": "abc"},
    )
    assert r.status_code in (400, 422)


def test_decision_log_body_is_capped_at_64k(monkeypatch):
    client = _client(monkeypatch, delegated=True)
    body = json.dumps({"point": "p", "answers": {"k": "x" * (70 * 1024)}})
    r = client.post("/api/v1/decisions/log", content=body, headers={**H, "content-type": "application/json"})
    assert r.status_code == 413


# --------------------------------------------------------------------------- headers (M6)


def test_security_headers_on_json_errors_and_health(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    from backend.main import create_app

    client = TestClient(create_app(), raise_server_exceptions=False)
    for r in (client.get("/healthz"), client.get("/api/v1/niches")):  # 200 and 401
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert "max-age" in r.headers["strict-transport-security"]
        assert r.headers["cache-control"] == "no-store"
        assert "default-src 'none'" in r.headers["content-security-policy"]


# --------------------------------------------------------------------------- person-only (H1)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/api/v1/tokens", {"name": "persist"}),
        ("get", "/api/v1/tokens", None),
        ("delete", f"/api/v1/tokens/{uuid4()}", None),
        ("delete", "/api/v1/users/me", None),
        ("get", "/api/v1/users/me/export", None),
    ],
)
def test_agent_delegation_cannot_mint_credentials_or_erase_the_account(monkeypatch, method, path, body):
    """The service token acts as any tenant. A personal token would carry the
    tenant's stored role (admin included) and outlive the call; erasure cannot
    be undone. Both are refused before any repo is touched."""
    from marketer.repos import privacy
    from marketer.repos import tokens as tokens_repo

    touched: list[str] = []

    async def _boom(*a, **k):
        touched.append("repo")
        raise AssertionError("must not be reached")

    for name in ("create", "list_for_user", "revoke"):
        monkeypatch.setattr(tokens_repo, name, _boom)
    monkeypatch.setattr(privacy, "erase_user", _boom)
    monkeypatch.setattr(privacy, "export_user", _boom)

    client = _client(monkeypatch, delegated=True, role="admin")
    r = client.request(method.upper(), path, json=body, headers=H)
    assert r.status_code == 403, r.text
    assert "person" in r.json()["detail"]
    assert touched == []


def test_a_person_can_still_erase_their_account(monkeypatch):
    from marketer.repos import privacy

    erased: list[str] = []

    async def _erase(user_id):
        erased.append(user_id)

    monkeypatch.setattr(privacy, "erase_user", _erase)
    r = _client(monkeypatch).delete("/api/v1/users/me", headers=H)
    assert r.status_code == 204
    assert erased == [USER]


# --------------------------------------------------------------------------- rate limits (M2)


def test_per_user_rate_limit_is_keyed_on_the_tenant(monkeypatch):
    from fastapi import FastAPI

    from backend.auth import require_user
    from backend.security import user_rate_limit

    who = {"id": USER}

    async def _fake():
        return ctx_for("owner", user_id=who["id"], email="p@t.com")

    app = FastAPI()

    @app.post("/spawn", dependencies=[user_rate_limit("test.spawn", "3/minute")])
    async def spawn() -> dict:
        return {"ok": True}

    app.dependency_overrides[require_user] = _fake
    client = TestClient(app)
    assert [client.post("/spawn").status_code for _ in range(4)] == [200, 200, 200, 429]
    assert client.post("/spawn").headers["retry-after"] == "60"
    # Another tenant has its own bucket; a header cannot pick the bucket.
    who["id"] = OTHER
    assert client.post("/spawn", headers={"x-tenant-id": USER}).status_code == 200


def test_expensive_routes_declare_a_per_user_limit():
    """The routes that spawn paid work or call a provider on request."""
    from backend.routes import (
        articles, billing, decisions, failures, image_posts, jobs, library, niches,
        templates, voices, webhook_endpoints, x402,
    )

    def limited(module) -> set[str]:
        out = set()
        for route in module.router.routes:
            deps = route.dependant.dependencies
            if any("user_rate_limit" in getattr(d.call, "__qualname__", "") for d in deps):
                out |= {f"{m} {route.path}" for m in route.methods}
        return out

    expected = {
        jobs: {"POST ", "POST /{job_id}/retry"},
        articles: {"POST ", "POST /{article_id}/social", "POST /{article_id}/retry"},
        image_posts: {"POST ", "POST /{image_post_id}/retry"},
        templates: {"POST /{template_id}/remix"},
        niches: {"POST /draft"},
        library: {"POST /compositions"},
        failures: {"POST /replay/{kind}/{item_id}"},
        decisions: {"POST /log", "POST /{decision_id}/outcome"},
        x402: {"POST /credits"},
        billing: {"POST /checkout"},
        webhook_endpoints: {"POST ", "POST /{endpoint_id}/test"},
        voices: {"GET /{voice}/preview"},
    }
    for module, routes in expected.items():
        assert routes <= limited(module), (module.__name__, routes - limited(module))


def test_agent_calls_are_bucketed_per_tenant_only_with_the_real_service_token(monkeypatch):
    from backend import rate_limit
    from marketer.config import settings

    monkeypatch.setattr(settings, "agent_service_token", "svc_" + "a" * 40)

    def req(token, tenant):
        return types.SimpleNamespace(
            headers={"authorization": f"Bearer {token}", "x-tenant-id": tenant, "x-forwarded-for": "9.9.9.9"},
            client=types.SimpleNamespace(host="10.0.0.1"),
        )

    assert rate_limit._limit_key(req("svc_" + "a" * 40, "user_a")) == "agent:user_a"
    assert rate_limit._limit_key(req("svc_" + "a" * 40, "user_b")) == "agent:user_b"
    # Anyone else choosing a tenant header stays on their IP bucket.
    assert rate_limit._limit_key(req("mkt_guess", "user_a")) == "9.9.9.9"
    monkeypatch.setattr(settings, "agent_service_token", "")
    assert rate_limit._limit_key(req("", "user_a")) == "9.9.9.9"


def test_decision_log_is_rate_limited_per_tenant(monkeypatch):
    from backend.routes import decisions
    from marketer.repos import decision_log as decision_log_repo

    async def insert(**kw):
        return uuid4()

    monkeypatch.setattr(decision_log_repo, "insert", insert)
    monkeypatch.setattr(decisions, "LOG_RATE_LIMIT", "300/minute")
    body = {
        "point": "route_department", "mode": "shadow", "questions_version": "v1",
        "fallback_used": False, "action_taken": "x",
    }
    client = _client(monkeypatch, delegated=True)
    codes = [client.post("/api/v1/decisions/log", json=body, headers=H).status_code for _ in range(301)]
    assert codes[:300] == [201] * 300
    assert codes[300] == 429


# --------------------------------------------------------------------------- decisions outcome (3.3)


def test_outcome_route_records_only_on_the_callers_decision(monkeypatch):
    from marketer.repos import decision_log as decision_log_repo

    mine = uuid4()
    calls: list[dict] = []

    async def record_outcome(decision_id, *, user_id, outcome=None, correction=None):
        calls.append({"id": decision_id, "user_id": user_id, "outcome": outcome, "correction": correction})
        return decision_id == mine and user_id == USER

    monkeypatch.setattr(decision_log_repo, "record_outcome", record_outcome)
    client = _client(monkeypatch)

    r = client.post(f"/api/v1/decisions/{mine}/outcome", json={"correction": {"action": "regenerate"}}, headers=H)
    assert r.status_code == 200 and r.json() == {"id": str(mine), "ok": True}
    assert calls[-1] == {"id": mine, "user_id": USER, "outcome": None, "correction": {"action": "regenerate"}}

    # Someone else's decision (or none at all): 404, same answer either way.
    r = client.post(f"/api/v1/decisions/{uuid4()}/outcome", json={"outcome": {"views": 1}}, headers=H)
    assert r.status_code == 404

    # The other tenant cannot write to `mine` even with the right id.
    other = _client(monkeypatch, user_id=OTHER)
    r = other.post(f"/api/v1/decisions/{mine}/outcome", json={"outcome": {"views": 1}}, headers=H)
    assert r.status_code == 404
    assert calls[-1]["user_id"] == OTHER  # the tenant came from auth, never the body


def test_outcome_route_rejects_empty_oversized_and_unknown_fields(monkeypatch):
    from marketer.repos import decision_log as decision_log_repo

    async def record_outcome(*a, **k):
        raise AssertionError("must not be reached")

    monkeypatch.setattr(decision_log_repo, "record_outcome", record_outcome)
    client = _client(monkeypatch)
    url = f"/api/v1/decisions/{uuid4()}/outcome"
    assert client.post(url, json={}, headers=H).status_code == 422
    assert client.post(url, json={"outcome": {"k": "x" * 9000}}, headers=H).status_code == 422
    assert client.post(url, json={"outcome": {"a": 1}, "user_id": OTHER}, headers=H).status_code == 422
    assert client.post("/api/v1/decisions/not-a-uuid/outcome", json={"outcome": {"a": 1}}, headers=H).status_code == 422


def test_outcome_route_requires_auth(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    from backend.main import create_app

    r = TestClient(create_app()).post(f"/api/v1/decisions/{uuid4()}/outcome", json={"outcome": {"a": 1}})
    assert r.status_code == 401


# --------------------------------------------------------------------------- rails: playbook limits (3.1)


def test_raising_the_playbook_cap_goes_through_the_rails(monkeypatch, rails_store, niches):
    client = _client(monkeypatch)
    r = client.put(f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "20.00"}, headers=H)
    assert r.status_code == 200, r.text
    assert niches["niche"].daily_spend_cap_usd == Decimal("20.00")
    assert _outcomes(rails_store) == [("playbook.spend_cap.raise", "succeeded")]
    [row] = rails_store.rows.values()
    assert (row.target_type, row.target_id, row.principal) == ("niche", str(NICHE_ID), "user")


def test_spend_kill_switch_stops_a_raise_but_never_a_lowering(monkeypatch, rails_store, niches):
    rails_store.kill_switches.add("spend")
    client = _client(monkeypatch)
    r = client.put(f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "20.00"}, headers=H)
    assert r.status_code == 402
    assert r.json()["detail"].startswith("kill_switch")
    assert niches["updates"] == []  # refused before the write
    assert niches["niche"].daily_spend_cap_usd == Decimal("5.00")

    r = client.put(f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "1.00"}, headers=H)
    assert r.status_code == 200
    assert niches["niche"].daily_spend_cap_usd == Decimal("1.00")
    assert ("playbook.spend_cap.lower", "succeeded") in _outcomes(rails_store)
    assert ("playbook.spend_cap.raise", "denied") in _outcomes(rails_store)


def test_removing_the_approval_gate_is_high_and_person_only(monkeypatch, rails_store, niches):
    # The agent may never take the gate away, whatever it was told.
    agent = _client(monkeypatch, delegated=True)
    r = agent.put(f"/api/v1/niches/{NICHE_ID}", json={"approve_before_post": False}, headers=H)
    assert r.status_code == 403
    assert niches["updates"] == [] and niches["niche"].approve_before_post is True

    # A person can, unless publishing is stopped.
    rails_store.kill_switches.add("publish")
    person = _client(monkeypatch)
    r = person.put(f"/api/v1/niches/{NICHE_ID}", json={"approve_before_post": False}, headers=H)
    assert r.status_code == 402 and niches["updates"] == []
    rails_store.kill_switches.clear()
    r = person.put(f"/api/v1/niches/{NICHE_ID}", json={"approve_before_post": False}, headers=H)
    assert r.status_code == 200 and niches["niche"].approve_before_post is False
    assert ("playbook.approval.disable", "succeeded") in _outcomes(rails_store)

    # Putting the gate back reduces exposure: never blocked, agent included.
    rails_store.kill_switches.add("all")
    r = agent.put(f"/api/v1/niches/{NICHE_ID}", json={"approve_before_post": True}, headers=H)
    assert r.status_code == 200 and niches["niche"].approve_before_post is True
    assert ("playbook.approval.enable", "succeeded") in _outcomes(rails_store)


def test_cap_change_with_a_replayed_idempotency_key_dispatches_once(monkeypatch, rails_store, niches):
    client = _client(monkeypatch, delegated=True)
    headers = {**H, "idempotency-key": "run1:call7"}
    r = client.put(f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "9.00"}, headers=headers)
    assert r.status_code == 200
    # The harness replays the same call after the cap was changed back by hand.
    niches["niche"] = niches["niche"].model_copy(update={"daily_spend_cap_usd": Decimal("5.00")})
    r = client.put(f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "9.00"}, headers=headers)
    assert r.status_code == 409 and r.json()["detail"].startswith("duplicate_dispatch")
    assert niches["niche"].daily_spend_cap_usd == Decimal("5.00")
    [row] = [r_ for r_ in rails_store.rows.values() if r_.outcome == "succeeded"]
    assert row.principal == "agent"


def test_rails_store_outage_refuses_the_cap_change(monkeypatch, rails_store, niches):
    rails_store.fail_reads = True
    r = _client(monkeypatch).put(f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "20.00"}, headers=H)
    assert r.status_code == 503
    assert niches["updates"] == []


def test_updates_that_leave_the_limits_alone_do_not_dispatch(monkeypatch, rails_store, niches):
    client = _client(monkeypatch)
    rails_store.kill_switches.add("all")
    # Positioning fields, and a cap "change" to the value it already has.
    assert client.put(f"/api/v1/niches/{NICHE_ID}", json={"title": "New"}, headers=H).status_code == 200
    r = client.put(f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "5.00", "approve_before_post": True}, headers=H)
    assert r.status_code == 200
    assert rails_store.rows == {}


def test_cap_change_on_someone_elses_playbook_is_404_and_unrecorded(monkeypatch, rails_store, niches):
    r = _client(monkeypatch, user_id=OTHER).put(
        f"/api/v1/niches/{NICHE_ID}", json={"daily_spend_cap_usd": "500.00"}, headers=H
    )
    assert r.status_code == 404
    assert niches["updates"] == [] and rails_store.rows == {}


@pytest.mark.parametrize(
    "patch",
    [
        {"scene_count": 10_000},
        {"target_duration_sec": 100_000},
        {"daily_spend_cap_usd": "99999999"},   # would overflow numeric(8,2) into a 500
        {"hashtags": ["#x"] * 51},
        {"title": "t" * 201},
        {"posting_windows": [{"hour": 9, "minute": 0, "tz": "UTC"}] * 49},
    ],
)
def test_playbook_inputs_are_bounded(monkeypatch, niches, patch):
    r = _client(monkeypatch).put(f"/api/v1/niches/{NICHE_ID}", json=patch, headers=H)
    assert r.status_code == 422
    assert niches["updates"] == []


# --------------------------------------------------------------------------- rails: brand kit, account cap


def test_brand_kit_update_is_recorded_and_stopped_by_the_kill_switch(monkeypatch, rails_store):
    from marketer.repos import brand_kit as repo

    saved: list = []

    async def _upsert(user_id, kit):
        saved.append((user_id, kit))
        return kit

    monkeypatch.setattr(repo, "upsert", _upsert)
    client = _client(monkeypatch, delegated=True)
    body = {"brand_name": "Acme", "banned_words": ["cheap"], "preferred_hashtags": ["acme"]}
    r = client.put("/api/v1/brand-kit", json=body, headers=H)
    assert r.status_code == 200 and saved[0][0] == USER
    [row] = rails_store.rows.values()
    assert (row.action, row.outcome, row.principal, row.target_id) == ("brand_kit.update", "succeeded", "agent", USER)

    rails_store.kill_switches.add("all")
    r = client.put("/api/v1/brand-kit", json=body, headers=H)
    assert r.status_code == 402 and len(saved) == 1

    rails_store.kill_switches.clear()
    rails_store.fail_reads = True
    r = client.put("/api/v1/brand-kit", json=body, headers=H)
    assert r.status_code == 503 and len(saved) == 1


def test_brand_kit_rejects_oversized_entries(monkeypatch):
    client = _client(monkeypatch)
    assert client.put("/api/v1/brand-kit", json={"banned_words": ["w" * 61]}, headers=H).status_code == 422
    assert client.put("/api/v1/brand-kit", json={"banned_words": ["w"] * 101}, headers=H).status_code == 422


@pytest.fixture
def account(monkeypatch):
    from marketer.repos import users as users_repo

    state = {"cap": Decimal("10.00"), "writes": 0}

    def _user():
        return User(id=USER, email="p@t.com", global_daily_cap_usd=state["cap"])

    async def _get(user_id):
        return _user()

    async def _update(user_id, *, global_daily_cap_usd=..., email_notifications=...):
        state["writes"] += 1
        if global_daily_cap_usd is not ...:
            state["cap"] = global_daily_cap_usd
        return _user()

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(users_repo, "update_settings", _update)
    return state


def test_global_cap_raise_and_removal_go_through_the_rails(monkeypatch, rails_store, account):
    client = _client(monkeypatch)
    rails_store.kill_switches.add("spend")
    for body in ({"global_daily_cap_usd": "50.00"}, {"global_daily_cap_usd": None}):
        r = client.patch("/api/v1/users/me", json=body, headers=H)
        assert r.status_code == 402, body
    assert account["cap"] == Decimal("10.00") and account["writes"] == 0

    # Tightening is never blocked.
    r = client.patch("/api/v1/users/me", json={"global_daily_cap_usd": "2.00"}, headers=H)
    assert r.status_code == 200 and account["cap"] == Decimal("2.00")

    rails_store.kill_switches.clear()
    r = client.patch("/api/v1/users/me", json={"global_daily_cap_usd": None}, headers=H)
    assert r.status_code == 200 and account["cap"] is None
    assert ("account.spend_cap.raise", "succeeded") in _outcomes(rails_store)
    assert ("account.spend_cap.lower", "succeeded") in _outcomes(rails_store)

    # Setting a cap where there was none is a tightening.
    r = client.patch("/api/v1/users/me", json={"global_daily_cap_usd": "5.00"}, headers=H)
    assert r.status_code == 200
    assert [a for a, _ in _outcomes(rails_store)].count("account.spend_cap.lower") == 2


def test_the_agent_can_lower_the_global_cap_but_never_raise_or_remove_it(monkeypatch, rails_store, account):
    agent = _client(monkeypatch, delegated=True)
    for body in ({"global_daily_cap_usd": "999.00"}, {"global_daily_cap_usd": None}):
        r = agent.patch("/api/v1/users/me", json=body, headers=H)
        assert r.status_code == 403, body
    assert account["writes"] == 0 and rails_store.rows == {}
    r = agent.patch("/api/v1/users/me", json={"global_daily_cap_usd": "1.00"}, headers=H)
    assert r.status_code == 200 and account["cap"] == Decimal("1.00")
    # Unrelated settings do not dispatch.
    r = agent.patch("/api/v1/users/me", json={"email_notifications": False}, headers=H)
    assert r.status_code == 200
    assert _outcomes(rails_store) == [("account.spend_cap.lower", "succeeded")]


def test_new_limit_actions_are_registered_high_with_the_right_scopes():
    from marketer.rails import actions

    expect = {
        "playbook.spend_cap.raise": ({"spend"}, False),
        "playbook.spend_cap.lower": (set(), True),
        "playbook.approval.disable": ({"publish"}, False),
        "playbook.approval.enable": (set(), True),
        "account.spend_cap.raise": ({"spend"}, False),
        "account.spend_cap.lower": (set(), True),
        "brand_kit.update": (set(), False),
    }
    for name, (scopes, reduces) in expect.items():
        spec = actions.ACTIONS[name]
        assert spec.tier == "HIGH"
        assert set(spec.scopes) == scopes and spec.reduces_exposure is reduces


# --------------------------------------------------------------------------- failures replay (H2)


@pytest.fixture
def modal_spawns(monkeypatch):
    calls: list[tuple] = []

    class _Fn:
        def __init__(self, name):
            self.name = name

        def spawn(self, *a):
            calls.append((self.name, *a))

    monkeypatch.setitem(
        sys.modules, "modal",
        types.SimpleNamespace(Function=types.SimpleNamespace(from_name=lambda app, name: _Fn(name))),
    )
    return calls


async def _unknown_send(target_type: str, target_id: str):
    from marketer import rails

    d = await rails.enforce_dispatch(
        "content.post.send", user_id=USER, principal="system", args={"id": target_id},
        target_type=target_type, target_id=target_id,
    )
    await d.indeterminate("ReadTimeout")
    return d.execution_id


@pytest.mark.parametrize(("kind", "target_type"), [("job", "video_post"), ("image_post", "carousel_post")])
async def test_inbox_replay_is_blocked_while_a_post_outcome_is_unknown(
    monkeypatch, rails_store, modal_spawns, kind, target_type
):
    """The replay route is the retry route by another address. It used to skip
    the unknown-outcome check, so the inbox was a way to post twice."""
    from marketer.repos import image_posts as image_posts_repo
    from marketer.repos import jobs as jobs_repo

    item = uuid4()
    claimed: list[UUID] = []

    async def _reset(job_id, *, user_id):
        claimed.append(job_id)
        return Job(id=job_id, user_id=user_id, niche_id=uuid4(), platform="tiktok", status=JobStatus.queued)

    async def _claim(post_id, *, user_id):
        claimed.append(post_id)
        return True

    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)
    monkeypatch.setattr(image_posts_repo, "claim_for_retry", _claim)
    execution_id = await _unknown_send(target_type, str(item))

    client = _client(monkeypatch)
    r = await asyncio.to_thread(client.post, f"/api/v1/failures/replay/{kind}/{item}", headers=H)
    assert r.status_code == 409 and r.json()["detail"].startswith("outcome_unknown")
    assert claimed == [] and modal_spawns == []

    await rails_store.resolve(USER, execution_id, resolution="confirmed_failed", resolved_by="p@t.com")
    r = await asyncio.to_thread(client.post, f"/api/v1/failures/replay/{kind}/{item}", headers=H)
    assert r.status_code == 202
    assert claimed == [item] and len(modal_spawns) == 1


# --------------------------------------------------------------------------- IDOR: ad campaign niche (M4)


def test_ad_campaign_cannot_be_attached_to_another_tenants_playbook(monkeypatch, niches):
    from marketer.repos import ad_actions
    from marketer.repos import ads as ads_repo

    created: list[dict] = []
    account_id = uuid4()

    async def _get_account(aid, *, user_id):
        return types.SimpleNamespace(id=aid, platform="meta_ads") if user_id == OTHER else None

    async def _create(**kw):
        created.append(kw)
        raise AssertionError("must not be reached")

    async def _record(**kw):
        return None

    monkeypatch.setattr(ads_repo, "get_account", _get_account)
    monkeypatch.setattr(ads_repo, "create_campaign", _create)
    monkeypatch.setattr(ad_actions, "record", _record)
    # OTHER owns the ad account; NICHE_ID belongs to USER.
    client = _client(monkeypatch, user_id=OTHER)
    r = client.post(
        "/api/v1/ads/campaigns",
        json={"ad_account_id": str(account_id), "name": "x", "niche_id": str(NICHE_ID)}, headers=H,
    )
    assert r.status_code == 404 and r.json()["detail"] == "niche not found"
    assert created == []


def test_ads_list_limits_are_validated(monkeypatch):
    client = _client(monkeypatch)
    assert client.get("/api/v1/ads/actions?limit=-5", headers=H).status_code == 422
    assert client.get("/api/v1/ads/actions?limit=100000", headers=H).status_code == 422


# --------------------------------------------------------------------------- healthz leak (M5)


def test_deep_health_does_not_echo_driver_errors(monkeypatch):
    from backend.routes import healthz
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    secret = "postgres://admin:hunter2@10.1.2.3:5432/prod"

    async def _boom():
        raise RuntimeError(f"could not connect to {secret}")

    monkeypatch.setattr(healthz, "get_pool", _boom)
    from backend.main import create_app

    r = TestClient(create_app()).get("/healthz/deep")
    assert r.status_code == 503
    assert r.json()["checks"]["db"]["error"] == "RuntimeError"
    assert "hunter2" not in r.text and "10.1.2.3" not in r.text and "MARKETER_" not in r.text


def test_error_details_do_not_carry_provider_text(monkeypatch):
    from marketer.agents import niche_draft
    from marketer.repos import brand_kit as brand_kit_repo

    async def _kit(user_id):
        return None

    async def _fail(text, *, brand_context=""):
        raise RuntimeError("org-abc123 key sk-live-XYZ rate limited")

    monkeypatch.setattr(brand_kit_repo, "get", _kit)
    monkeypatch.setattr(niche_draft, "draft_niche", _fail)
    r = _client(monkeypatch).post("/api/v1/niches/draft", json={"description": "a channel about bread"}, headers=H)
    assert r.status_code == 502
    assert "sk-live" not in r.text and "org-abc123" not in r.text


# --------------------------------------------------------------------------- SSRF (M3)


def test_ssrf_guard_refuses_internal_and_disguised_addresses():
    from marketer.services import ssrf

    for url in (
        "https://127.0.0.1/x", "https://10.0.0.5/x", "https://169.254.169.254/latest/meta-data",
        "https://[::1]/x", "https://[::ffff:169.254.169.254]/x", "https://100.64.0.1/x",
        "https://[fd00:ec2::254]/x", "https://0.0.0.0/x", "https://metadata.google.internal/x",
        "https://metadata.google.internal./x", "https://user:pw@8.8.8.8/x", "http://8.8.8.8/x",
        "https://8.8.8.8:99999/x", "https:///x",
    ):
        ok, reason, address = ssrf.resolve_public_url(url)
        assert not ok and address is None, url
        assert reason
    assert ssrf.resolve_public_url("https://8.8.8.8/hook") == (True, "", "8.8.8.8")


def test_ssrf_guard_refuses_a_name_with_any_internal_answer(monkeypatch):
    from marketer.services import ssrf

    def _answers(*ips):
        return lambda host, port, proto=0: [(2, 1, 6, "", (ip, port)) for ip in ips]

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _answers("93.184.216.34", "10.0.0.7"))
    assert ssrf.resolve_public_url("https://mixed.example/x")[0] is False
    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _answers("93.184.216.34"))
    assert ssrf.resolve_public_url("https://ok.example/x") == (True, "", "93.184.216.34")


async def test_delivery_connects_to_the_address_it_checked_not_to_the_name(monkeypatch):
    """DNS rebinding: the name answers public for the check and internal for
    the connection. Delivery must use the checked address, so the second
    answer never matters; and it must not follow a redirect to one."""
    from marketer.services import ssrf, webhook_delivery

    answers = iter(["93.184.216.34", "169.254.169.254"])

    def _rebinding(host, port, proto=0):
        return [(2, 1, 6, "", (next(answers), port))]

    monkeypatch.setattr(ssrf.socket, "getaddrinfo", _rebinding)
    seen: dict = {}

    class _Client:
        def __init__(self, *a, **k):
            seen["client_kwargs"] = k

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, *, content, headers, extensions=None):
            seen.update(url=url, host=headers["host"], extensions=extensions)
            return types.SimpleNamespace(status_code=302)

    monkeypatch.setattr(webhook_delivery.httpx, "AsyncClient", _Client)
    code = await webhook_delivery.deliver_one(
        "https://rebind.example:8443/in", "whsec_x", event="job.done", payload={}, timestamp=1,
    )
    assert code == 302  # reported as is; nothing followed it
    assert seen["url"] == "https://93.184.216.34:8443/in"
    assert seen["host"] == "rebind.example:8443"
    assert seen["extensions"] == {"sni_hostname": "rebind.example"}
    assert seen["client_kwargs"]["follow_redirects"] is False


async def test_delivery_to_an_internal_address_is_never_sent(monkeypatch):
    from marketer.services import webhook_delivery

    class _Client:
        def __init__(self, *a, **k):
            raise AssertionError("must not connect")

    monkeypatch.setattr(webhook_delivery.httpx, "AsyncClient", _Client)
    code = await webhook_delivery.deliver_one(
        "https://169.254.169.254/latest", "whsec_x", event="job.done", payload={}, timestamp=1,
    )
    assert code is None


async def test_pinned_connection_still_verifies_the_endpoints_certificate():
    """Connecting by IP must not weaken TLS: the certificate is checked against
    the endpoint's hostname, and a certificate for another name is refused."""
    import datetime as dt
    import ssl
    import tempfile
    from pathlib import Path

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    from marketer.services import ssrf

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "hooks.test")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("hooks.test")]), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    with tempfile.TemporaryDirectory() as tmp:
        cert_path, key_path = Path(tmp) / "c.pem", Path(tmp) / "k.pem"
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ))
        server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_ctx.load_cert_chain(cert_path, key_path)
        requests: list[str] = []

        async def handle(reader, writer):
            requests.append((await reader.read(4096)).decode(errors="replace"))
            writer.write(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(handle, "127.0.0.1", 0, ssl=server_ctx)
        port = server.sockets[0].getsockname()[1]
        target, host_header, server_name = ssrf.pinned_target(f"https://hooks.test:{port}/in", "127.0.0.1")
        client_ctx = ssl.create_default_context(cafile=str(cert_path))
        try:
            async with httpx.AsyncClient(verify=client_ctx, trust_env=False, timeout=5) as client:
                ok = await client.post(
                    target, content=b"{}", headers={"host": host_header},
                    extensions={"sni_hostname": server_name},
                )
                assert ok.status_code == 200
                assert f"host: hooks.test:{port}" in requests[0].lower()
                with pytest.raises(httpx.ConnectError):
                    await client.post(
                        target, content=b"{}", headers={"host": host_header},
                        extensions={"sni_hostname": "evil.test"},
                    )
        finally:
            server.close()
            await server.wait_closed()


def test_webhook_endpoints_are_capped_per_account(monkeypatch):
    import marketer.repos.webhooks_out as repo
    from backend.routes import webhook_endpoints

    async def _full(user_id):
        return [object()] * webhook_endpoints.MAX_ENDPOINTS_PER_USER

    async def _create(**kw):
        raise AssertionError("must not be reached")

    monkeypatch.setattr(repo, "list_for_user", _full)
    monkeypatch.setattr(repo, "create", _create)
    monkeypatch.setattr("marketer.services.ssrf.check_public_url", lambda url: (True, ""))
    r = _client(monkeypatch).post(
        "/api/v1/webhook-endpoints", json={"url": "https://ok.example/x", "events": []}, headers=H
    )
    assert r.status_code == 409


# --------------------------------------------------------------------------- inbound webhooks (M7)

AYR_SECRET = "ayr-test-secret"


def _signed(payload: dict) -> tuple[bytes, dict]:
    body = json.dumps(payload).encode()
    sig = base64.b64encode(hmac.new(AYR_SECRET.encode(), body, hashlib.sha256).digest()).decode()
    return body, {"content-type": "application/json", "x-ayrshare-signature": sig}


@pytest.fixture
def ayrshare(monkeypatch):
    from marketer.config import settings
    from marketer.repos import idempotency as idempotency_repo
    from marketer.repos import jobs as jobs_repo

    monkeypatch.setattr(settings, "ayrshare_webhook_secret", AYR_SECRET)
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    state = {"claimed": set(), "saved": [], "lookups": [], "fail_save": False, "fail_claim": False}

    async def _claim(key, *, ttl_seconds=0):
        if state["fail_claim"]:
            raise RuntimeError("db down")
        if key in state["claimed"]:
            return False
        state["claimed"].add(key)
        return True

    async def _release(key):
        state["claimed"].discard(key)

    async def _lookup(post_id):
        state["lookups"].append(post_id)
        return Job(id=uuid4(), user_id=USER, niche_id=uuid4(), platform="tiktok",
                   status=JobStatus.scheduling, provider_post_id=post_id)

    async def _save(job):
        if state["fail_save"]:
            raise RuntimeError("write failed")
        state["saved"].append(job)

    monkeypatch.setattr(idempotency_repo, "claim", _claim)
    monkeypatch.setattr(idempotency_repo, "release", _release)
    monkeypatch.setattr(jobs_repo, "get_by_provider_post_id", _lookup)
    monkeypatch.setattr(jobs_repo, "save_snapshot", _save)
    from backend.main import create_app

    return TestClient(create_app(), raise_server_exceptions=False), state


def test_a_replayed_ayrshare_delivery_is_applied_once(ayrshare):
    client, state = ayrshare
    body, headers = _signed({"id": "post_1", "status": "errored", "errors": [{"message": "x"}]})
    assert client.post("/api/v1/webhooks/ayrshare", content=body, headers=headers).status_code == 200
    assert len(state["saved"]) == 1 and state["saved"][0].status == JobStatus.failed
    # The same signed bytes again (a captured delivery): answered, not applied.
    r = client.post("/api/v1/webhooks/ayrshare", content=body, headers=headers)
    assert r.status_code == 200 and len(state["saved"]) == 1


def test_a_failed_apply_releases_the_claim_so_the_providers_retry_lands(ayrshare):
    client, state = ayrshare
    body, headers = _signed({"id": "post_2", "status": "success", "errors": []})
    state["fail_save"] = True
    assert client.post("/api/v1/webhooks/ayrshare", content=body, headers=headers).status_code == 500
    assert state["claimed"] == set()
    state["fail_save"] = False
    assert client.post("/api/v1/webhooks/ayrshare", content=body, headers=headers).status_code == 200
    assert len(state["saved"]) == 1 and state["saved"][0].status == JobStatus.done


def test_ayrshare_webhook_without_a_post_id_touches_nothing(ayrshare):
    client, state = ayrshare
    body, headers = _signed({"id": "", "status": "errored", "errors": []})
    assert client.post("/api/v1/webhooks/ayrshare", content=body, headers=headers).status_code == 200
    assert state["lookups"] == [] and state["saved"] == []


def test_ayrshare_webhook_asks_for_a_retry_when_the_replay_store_is_down(ayrshare):
    client, state = ayrshare
    state["fail_claim"] = True
    body, headers = _signed({"id": "post_3", "status": "success", "errors": []})
    assert client.post("/api/v1/webhooks/ayrshare", content=body, headers=headers).status_code == 503
    assert state["saved"] == []


def test_ayrshare_webhook_bad_signature_is_refused_before_any_work(ayrshare):
    client, state = ayrshare
    body, _ = _signed({"id": "post_4", "status": "success"})
    r = client.post("/api/v1/webhooks/ayrshare", content=body, headers={"x-ayrshare-signature": "AAAA"})
    assert r.status_code == 401
    assert state["claimed"] == set() and state["lookups"] == []


def test_stripe_webhook_rejection_does_not_say_why(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    from backend.main import create_app

    r = TestClient(create_app()).post(
        "/api/v1/billing/webhook", content=b"{}", headers={"stripe-signature": "t=1,v1=bogus"}
    )
    assert r.status_code == 401
    assert r.json() == {"detail": "invalid webhook"}


def test_stripe_webhook_never_credits_an_amount_outside_the_packs(monkeypatch):
    import stripe as stripe_mod

    from marketer.config import settings
    from marketer.repos import billing as billing_repo

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    credited: list[dict] = []

    async def _credit(**kw):
        credited.append(kw)

    monkeypatch.setattr(billing_repo, "credit_purchase", _credit)
    from backend.main import create_app

    client = TestClient(create_app())

    def deliver(credit: str):
        event = {"type": "checkout.session.completed", "data": {"object": {
            "id": "cs_1", "payment_status": "paid", "metadata": {"user_id": USER, "credit_usd": credit},
        }}}
        monkeypatch.setattr(stripe_mod.Webhook, "construct_event", staticmethod(lambda p, s, sec: event))
        return client.post("/api/v1/billing/webhook", content=b"{}", headers={"stripe-signature": "ok"})

    for bad in ("1000000", "-5", "NaN", "not-a-number", "0"):
        assert deliver(bad).status_code == 200
    assert credited == []
    assert deliver("20.00").status_code == 200
    assert credited[0]["amount_usd"] == Decimal("20.00") and credited[0]["user_id"] == USER


# --------------------------------------------------------------------------- x402 (M8)


@pytest.fixture
def x402_on(monkeypatch):
    from marketer.config import settings
    from marketer.repos import billing

    monkeypatch.setattr(settings, "x402_enabled", True)
    monkeypatch.setattr(settings, "x402_pay_to", "0x" + "1" * 40)
    monkeypatch.setattr(settings, "x402_asset", "0x" + "2" * 40)
    credited: list[dict] = []

    async def _credit(**kw):
        credited.append(kw)
        return Decimal("10.00")

    monkeypatch.setattr(billing, "credit_purchase", _credit)
    return credited


def _payment_header() -> str:
    return base64.b64encode(json.dumps({"x402Version": 1, "payload": {"sig": "0xabc"}}).encode()).decode()


def test_x402_verify_outage_is_a_clean_502_and_nothing_is_credited(monkeypatch, x402_on):
    from marketer.services import x402

    calls: list[str] = []

    async def _post(path, body):
        calls.append(path)
        raise httpx.ConnectError("facilitator down")

    monkeypatch.setattr(x402, "_facilitator_post", _post)
    r = _client(monkeypatch).post(
        "/api/v1/x402/credits?amount_usd=10", headers={**H, "x-payment": _payment_header()}
    )
    assert r.status_code == 502 and "nothing was charged" in r.json()["detail"]
    assert calls == ["/verify"] and x402_on == []


def test_x402_settle_timeout_is_an_unknown_outcome_never_retried_never_credited(monkeypatch, x402_on):
    from marketer.services import x402

    calls: list[str] = []

    async def _post(path, body):
        calls.append(path)
        if path == "/verify":
            return {"isValid": True, "payer": "0xpayer"}
        raise httpx.ReadTimeout("settle timed out")

    monkeypatch.setattr(x402, "_facilitator_post", _post)
    r = _client(monkeypatch).post(
        "/api/v1/x402/credits?amount_usd=10", headers={**H, "x-payment": _payment_header()}
    )
    assert r.status_code == 502 and r.json()["detail"].startswith("outcome_unknown:")
    assert calls == ["/verify", "/settle"]  # exactly one settlement attempt
    assert x402_on == []


def test_x402_never_credits_more_than_was_paid():
    from marketer.services import x402

    assert x402.from_atomic("5009999") == Decimal("5.00")
    assert x402.from_atomic("5015000") == Decimal("5.01")
    assert x402.to_atomic(Decimal("5.019999999")) == "5019999"


# --------------------------------------------------------------------------- outbound calls (3.4)


def _status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "https://provider.test/x")
    return httpx.HTTPStatusError("x", request=req, response=httpx.Response(code, request=req))


def test_retry_predicates_separate_unsent_from_maybe_sent():
    from marketer.services.retry_policy import is_transient_http_error, is_unsent_or_refused

    for exc in (httpx.ConnectError("x"), httpx.ConnectTimeout("x"), httpx.PoolTimeout("x"), _status_error(429)):
        assert is_unsent_or_refused(exc), exc
    # Sent, answer unknown: a second attempt could duplicate it.
    for exc in (httpx.ReadTimeout("x"), httpx.WriteTimeout("x"), httpx.RemoteProtocolError("x"),
                httpx.ReadError("x"), _status_error(500), _status_error(503), _status_error(400), ValueError("x")):
        assert not is_unsent_or_refused(exc), exc
    for exc in (httpx.ReadTimeout("x"), httpx.ConnectError("x"), _status_error(502), _status_error(429)):
        assert is_transient_http_error(exc), exc
    for exc in (_status_error(400), _status_error(404), ValueError("x")):
        assert not is_transient_http_error(exc), exc


class _CountingClient:
    """Raises the scripted errors in order, then answers."""

    def __init__(self, errors, answer):
        self.errors, self.answer, self.posts = list(errors), answer, 0

    async def post(self, url, **kw):
        self.posts += 1
        if self.errors:
            raise self.errors.pop(0)
        return self.answer


@pytest.fixture
def no_wait(monkeypatch):
    """tenacity sleeps between attempts; make that instant."""
    import tenacity.nap

    async def _instant(seconds):
        return None

    monkeypatch.setattr(asyncio, "sleep", _instant)
    monkeypatch.setattr(tenacity.nap.time, "sleep", lambda s: None)


def _json_response(payload: dict) -> httpx.Response:
    return httpx.Response(200, json=payload, request=httpx.Request("POST", "https://provider.test/x"))


async def test_a_paid_grok_submit_is_not_repeated_after_it_may_have_landed(no_wait):
    from marketer.services import grok_imagine

    for maybe_sent in (httpx.ReadTimeout("x"), _status_error(500), _status_error(400)):
        client = _CountingClient([maybe_sent], _json_response({"request_id": "r1"}))
        with pytest.raises(type(maybe_sent)):
            await grok_imagine._submit(client, {"prompt": "x"})
        assert client.posts == 1, maybe_sent

    client = _CountingClient([httpx.ConnectError("x"), _status_error(429)], _json_response({"request_id": "r1"}))
    assert await grok_imagine._submit(client, {"prompt": "x"}) == "r1"
    assert client.posts == 3


async def test_a_paid_fal_submit_is_not_repeated_after_it_may_have_landed(no_wait):
    from marketer.services import fal_video

    ok = _json_response({"status_url": "https://q/s", "response_url": "https://q/r"})
    for maybe_sent in (httpx.ReadTimeout("x"), httpx.RemoteProtocolError("x"), _status_error(502)):
        client = _CountingClient([maybe_sent], ok)
        with pytest.raises(type(maybe_sent)):
            await fal_video._submit(client, "model", {})
        assert client.posts == 1, maybe_sent

    client = _CountingClient([httpx.ConnectTimeout("x")], ok)
    assert (await fal_video._submit(client, "model", {}))["status_url"] == "https://q/s"
    assert client.posts == 2


async def test_creating_an_ayrshare_profile_is_not_repeated_after_a_timeout(monkeypatch, no_wait):
    from marketer.config import settings
    from marketer.services import ayrshare_profiles

    monkeypatch.setattr(settings, "ayrshare_api_key", "k")
    posts = {"n": 0}

    class _Client:
        def __init__(self, *a, **k):
            assert k.get("timeout"), "explicit timeout required"

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            posts["n"] += 1
            raise httpx.ReadTimeout("x")

    monkeypatch.setattr(ayrshare_profiles.httpx, "AsyncClient", _Client)
    with pytest.raises(httpx.ReadTimeout):
        await ayrshare_profiles.create_profile(title="t")
    assert posts["n"] == 1


def test_provider_clients_carry_explicit_timeouts(monkeypatch):
    from backend import auth
    from marketer.articles import llm
    from marketer.config import settings
    from marketer.services import openai_images, openai_tts, openai_whisper

    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    for mod in (openai_tts, openai_images, openai_whisper):
        monkeypatch.setattr(mod, "_client", None)
        client = mod._get_client()
        assert 0 < float(client.timeout) <= 180
        # The tenacity policy on the call is the only retry.
        assert client.max_retries == 0
    monkeypatch.setattr(llm, "_client", None)
    assert 0 < float(llm._oai().timeout) <= 300

    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(auth, "_jwks_client", None)
    assert auth._jwks().timeout == auth.JWKS_TIMEOUT_SEC <= 10
    monkeypatch.setattr(auth, "_jwks_client", None)


async def test_a_silent_ad_connector_times_out_instead_of_hanging(monkeypatch):
    import time

    from marketer.services import ad_connections, composio_client

    monkeypatch.setattr(ad_connections, "CONNECTOR_TIMEOUT_SEC", 0.05)

    def _hang(**kw):
        time.sleep(0.5)

    monkeypatch.setattr(composio_client, "initiate_connection", _hang)
    with pytest.raises(composio_client.AdsDisabled):
        await ad_connections.start_connection(user_id=USER, platform="meta_ads")


async def test_an_agent_run_has_a_deadline(monkeypatch):
    from marketer.agents import metered

    async def _never(agent, input):
        await asyncio.sleep(3600)

    monkeypatch.setattr(metered, "AGENT_RUN_TIMEOUT_SEC", 0.05)
    monkeypatch.setattr(metered.Runner, "run", _never)
    with pytest.raises(asyncio.TimeoutError):
        await metered.run_metered(object(), "x")
