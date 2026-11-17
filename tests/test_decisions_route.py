"""/api/v1/decisions: the agent logs with the service token + x-tenant-id,
and a user reads back only their own decisions, paginated.

No DB: the decision_log repo is monkeypatched.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from marketer.models import User
from marketer.repos import decision_log as decision_log_repo
from marketer.repos.decision_log import DecisionLogEntry

SERVICE_TOKEN = "svc_" + "b" * 40
BODY = {
    "point": "route_department",
    "mode": "shadow",
    "model": "typesafe/jev-1.13-20260917",
    "questions_version": "route_department.v1",
    "state_hash": "ab" * 32,
    "answers": {"department": {"type": "choice", "choice": "analyst", "confidence": 0.8}},
    "fallback_used": False,
    "latency_ms": 212,
    "cost_usd": "0.00001",
    "action_taken": "delegate:analyst",
    "rule_action": "frontier",
    "table_action": "delegate:analyst",
}


@pytest.fixture
def store(monkeypatch) -> list[dict]:
    rows: list[dict] = []

    async def insert(**kw):
        rows.append(kw)
        return uuid4()

    monkeypatch.setattr(decision_log_repo, "insert", insert)
    return rows


@pytest.fixture
def agent_client(monkeypatch):
    """Full auth path: the real require_user with the agent service token."""
    from backend.routes import decisions
    from marketer.config import settings
    from marketer.repos import users as users_repo

    monkeypatch.setattr(settings, "agent_service_token", SERVICE_TOKEN)

    async def get(uid):
        return User(id=uid, email=f"{uid}@x.io") if uid == "user_t" else None

    monkeypatch.setattr(users_repo, "get", get)
    from backend import auth

    monkeypatch.setattr(auth, "_consume_failure_token", lambda req: None)
    app = FastAPI()
    app.include_router(decisions.router, prefix="/api/v1/decisions")
    return TestClient(app)


def test_agent_logs_as_the_tenant(agent_client, store):
    r = agent_client.post(
        "/api/v1/decisions/log",
        json={**BODY, "user_id": "someone_else"},  # ignored: tenant comes from auth
        headers={"authorization": f"Bearer {SERVICE_TOKEN}", "x-tenant-id": "user_t"},
    )
    assert r.status_code == 201, r.text
    assert "id" in r.json()
    assert store[0]["user_id"] == "user_t"
    assert store[0]["point"] == "route_department" and store[0]["fallback_used"] is False


def test_log_requires_tenant_header(agent_client, store):
    r = agent_client.post("/api/v1/decisions/log", json=BODY,
                          headers={"authorization": f"Bearer {SERVICE_TOKEN}"})
    assert r.status_code == 401 and store == []


def test_log_requires_auth(agent_client, store):
    assert agent_client.post("/api/v1/decisions/log", json=BODY).status_code == 401


@pytest.mark.parametrize(
    "patch",
    [
        {"mode": "yolo"},
        {"point": "Bad Point!"},
        {"state_hash": "not-hex"},
        {"latency_ms": -1},
        {"cost_usd": "-0.1"},
        {"answers": {"x": "y" * 40_000}},
    ],
)
def test_log_rejects_bad_bodies(agent_client, store, patch):
    r = agent_client.post(
        "/api/v1/decisions/log", json={**BODY, **patch},
        headers={"authorization": f"Bearer {SERVICE_TOKEN}", "x-tenant-id": "user_t"},
    )
    assert r.status_code == 422 and store == []


# ---------------------------------------------------------------------------
# GET: own decisions, paginated
# ---------------------------------------------------------------------------


def _entry(i: int) -> DecisionLogEntry:
    return DecisionLogEntry(
        id=uuid4(), point="hook_score", mode="shadow", model="m", questions_version="v1",
        answers=None, fallback_used=True, reason="timeout", latency_ms=1, cost_usd=None,
        action_taken="proceed", rule_action="proceed", table_action=None,
        subject_kind="job", subject_id=None, outcome=None, correction=None, outcome_at=None,
        created_at=datetime(2026, 11, 1, tzinfo=timezone.utc) - timedelta(minutes=i),
    )


@pytest.fixture
def user_client():
    from backend.auth import AuthCtx, require_user
    from backend.routes import decisions

    async def fake_user():
        return AuthCtx(user_id="user_t", email="t@x.io")

    app = FastAPI()
    app.include_router(decisions.router, prefix="/api/v1/decisions")
    app.dependency_overrides[require_user] = fake_user
    return TestClient(app)


def test_list_is_scoped_and_paginated(user_client, monkeypatch):
    rows = [_entry(i) for i in range(5)]
    calls = []

    async def list_for_user(user_id, *, limit, before=None, point=None):
        calls.append({"user_id": user_id, "limit": limit, "before": before, "point": point})
        start = 0
        if before is not None:
            start = next(i for i, r in enumerate(rows) if (r.created_at, r.id) == before) + 1
        return rows[start:start + limit]

    monkeypatch.setattr(decision_log_repo, "list_for_user", list_for_user)

    r = user_client.get("/api/v1/decisions?limit=2&point=hook_score")
    assert r.status_code == 200
    page = r.json()
    assert [i["id"] for i in page["items"]] == [str(rows[0].id), str(rows[1].id)]
    assert "state_hash" not in page["items"][0]
    assert calls[0] == {"user_id": "user_t", "limit": 3, "before": None, "point": "hook_score"}

    r = user_client.get(f"/api/v1/decisions?limit=2&cursor={page['next_cursor']}")
    page2 = r.json()
    assert [i["id"] for i in page2["items"]] == [str(rows[2].id), str(rows[3].id)]
    r = user_client.get(f"/api/v1/decisions?limit=2&cursor={page2['next_cursor']}")
    assert [i["id"] for i in r.json()["items"]] == [str(rows[4].id)]
    assert r.json()["next_cursor"] is None


def test_list_rejects_a_bad_cursor(user_client):
    assert user_client.get("/api/v1/decisions?cursor=%%%").status_code == 400


def test_cursor_round_trip():
    e = _entry(3)
    assert decision_log_repo.decode_cursor(
        decision_log_repo.encode_cursor(e.created_at, e.id)) == (e.created_at, e.id)


def test_router_is_registered_in_the_app():
    from backend.main import create_app

    paths = set(create_app().openapi()["paths"])
    assert {"/api/v1/decisions", "/api/v1/decisions/log"} <= paths


def test_people_cannot_author_decision_logs(user_client):
    # Only the agent (service token + x-tenant-id) writes the log.
    r = user_client.post("/api/v1/decisions/log", json=BODY)
    assert r.status_code == 403
