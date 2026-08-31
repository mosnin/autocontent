"""HTTP tests for /api/v1/gatekeeper — the approval inbox.

Decide is the money-moving surface: a foreign intent must 404, a second
click on an already-decided row must 409 (not look like success), and
bulk decide must skip leftovers rather than fail the batch.
"""
from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from backend.routes.gatekeeper import MAX_BULK
from marketer.config import settings
from marketer.repos import gatekeeper as repo

USER = "user_gk"
AUTH = {"Authorization": "Bearer mkt_x"}


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id=USER, email="g@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _intent(intent_id: UUID, *, status: str = "pending") -> dict:
    return {
        "id": str(intent_id),
        "user_id": USER,
        "capability": "ads.change_budget",
        "summary": "Raise daily budget",
        "params": {"daily_budget_usd": "50"},
        "simulated": {"delta_usd": "20"},
        "status": status,
        "reason": "",
        "dollar_delta": "20.00",
        "evidence": {},
        "actor": "agent",
        "origin": "",
    }


@pytest.fixture
def client(monkeypatch) -> TestClient:
    _reset_limiter()
    return _client(monkeypatch)


def test_gatekeeper_routes_require_auth(monkeypatch):
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.main import create_app

    unauth = TestClient(create_app(), raise_server_exceptions=False)
    intent_id = uuid4()
    assert unauth.get("/api/v1/gatekeeper/intents").status_code == 401
    assert unauth.get(f"/api/v1/gatekeeper/intents/{intent_id}").status_code == 401
    assert unauth.post(
        f"/api/v1/gatekeeper/intents/{intent_id}/decide",
        json={"approved": True},
    ).status_code == 401
    assert unauth.post(
        "/api/v1/gatekeeper/intents/decide",
        json={"intent_ids": [str(intent_id)], "approved": True},
    ).status_code == 401


def test_get_intent_foreign_or_missing_is_404(client, monkeypatch):
    seen: list[tuple] = []

    async def _get(intent_id, *, user_id):
        seen.append((intent_id, user_id))
        return None

    monkeypatch.setattr(repo, "get_intent", _get)
    intent_id = uuid4()
    resp = client.get(f"/api/v1/gatekeeper/intents/{intent_id}", headers=AUTH)
    assert resp.status_code == 404
    assert seen == [(intent_id, USER)]


def test_decide_foreign_or_missing_is_404(client, monkeypatch):
    decided: list[tuple] = []

    async def _decide(intent_id, *, user_id, approved, decided_by):
        decided.append((intent_id, user_id, approved, decided_by))
        return None

    async def _get(intent_id, *, user_id):
        return None

    monkeypatch.setattr(repo, "decide", _decide)
    monkeypatch.setattr(repo, "get_intent", _get)
    intent_id = uuid4()
    resp = client.post(
        f"/api/v1/gatekeeper/intents/{intent_id}/decide",
        json={"approved": True},
        headers=AUTH,
    )
    assert resp.status_code == 404
    assert decided == [(intent_id, USER, True, USER)]


def test_decide_already_decided_is_409(client, monkeypatch):
    intent_id = uuid4()
    claims: list[tuple] = []

    async def _decide(intent_id_, *, user_id, approved, decided_by):
        claims.append((intent_id_, user_id, approved, decided_by))
        return None

    async def _get(intent_id_, *, user_id):
        assert user_id == USER
        return _intent(intent_id_, status="approved")

    monkeypatch.setattr(repo, "decide", _decide)
    monkeypatch.setattr(repo, "get_intent", _get)
    resp = client.post(
        f"/api/v1/gatekeeper/intents/{intent_id}/decide",
        json={"approved": False},
        headers=AUTH,
    )
    assert resp.status_code == 409
    assert "already approved" in resp.json()["detail"]
    assert claims == [(intent_id, USER, False, USER)]


def test_decide_pending_returns_row(client, monkeypatch):
    intent_id = uuid4()
    seen: dict = {}

    async def _decide(intent_id_, *, user_id, approved, decided_by):
        seen.update(
            {
                "id": intent_id_,
                "user_id": user_id,
                "approved": approved,
                "decided_by": decided_by,
            }
        )
        return _intent(intent_id_, status="rejected")

    monkeypatch.setattr(repo, "decide", _decide)
    resp = client.post(
        f"/api/v1/gatekeeper/intents/{intent_id}/decide",
        json={"approved": False},
        headers=AUTH,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected"
    assert seen == {
        "id": intent_id,
        "user_id": USER,
        "approved": False,
        "decided_by": USER,
    }


def test_bulk_decide_skips_rows_the_claim_missed(client, monkeypatch):
    """One already-decided / foreign id must not fail the rest of the batch."""
    kept = uuid4()
    skipped = uuid4()
    seen: dict = {}

    async def _decide_many(intent_ids, *, user_id, approved, decided_by):
        seen.update(
            {
                "ids": list(intent_ids),
                "user_id": user_id,
                "approved": approved,
                "decided_by": decided_by,
            }
        )
        return [_intent(kept, status="approved")]

    monkeypatch.setattr(repo, "decide_many", _decide_many)
    resp = client.post(
        "/api/v1/gatekeeper/intents/decide",
        json={"intent_ids": [str(kept), str(skipped)], "approved": True},
        headers=AUTH,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["decided"] == 1
    assert body["skipped"] == [str(skipped)]
    assert seen["user_id"] == USER
    assert seen["approved"] is True
    assert seen["decided_by"] == USER
    assert seen["ids"] == [kept, skipped]


def test_bulk_decide_rejects_more_than_max(client, monkeypatch):
    called = []

    async def _decide_many(*args, **kwargs):
        called.append(True)
        return []

    monkeypatch.setattr(repo, "decide_many", _decide_many)
    resp = client.post(
        "/api/v1/gatekeeper/intents/decide",
        json={
            "intent_ids": [str(uuid4()) for _ in range(MAX_BULK + 1)],
            "approved": True,
        },
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert called == []
