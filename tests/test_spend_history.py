"""Tests for GET /api/v1/spend/history.

No DB required — spend_repo.history is monkeypatched. Auth is bypassed
via FastAPI dependency_overrides so the 30/min limiter can see Request.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient

from marketer.models import SpendHistoryRow

NICHE_A = UUID("00000000-0000-0000-0000-000000000001")
NICHE_B = UUID("00000000-0000-0000-0000-000000000002")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id="user_test", email="test@example.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def _make_row(day: date, niche_id: UUID, cost: str) -> SpendHistoryRow:
    return SpendHistoryRow(day=day, niche_id=niche_id, cost_usd=Decimal(cost))


def test_empty_history_returns_empty_rows(monkeypatch):
    _reset_limiter()
    import marketer.repos.spend as spend_repo

    async def _history(*, user_id, days, niche_id=None):
        return []

    monkeypatch.setattr(spend_repo, "history", _history)
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/spend/history",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["rows"] == []
    assert data["days"] == 30
    assert Decimal(data["total_usd"]) == Decimal(0)


def test_seeded_data_returns_expected_sums(monkeypatch):
    _reset_limiter()
    import marketer.repos.spend as spend_repo

    day1 = date(2026, 1, 1)
    day2 = date(2026, 1, 2)
    fake_rows = [
        _make_row(day1, NICHE_A, "0.25"),
        _make_row(day1, NICHE_B, "0.10"),
        _make_row(day2, NICHE_A, "0.40"),
    ]

    async def _history(*, user_id, days, niche_id=None):
        return fake_rows

    monkeypatch.setattr(spend_repo, "history", _history)
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/spend/history?days=7",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["rows"]) == 3
    assert Decimal(data["total_usd"]) == Decimal("0.75")
    assert data["days"] == 7


def test_niche_filter_forwarded_to_repo(monkeypatch):
    _reset_limiter()
    import marketer.repos.spend as spend_repo

    called_with: dict = {}

    async def _history(*, user_id, days, niche_id=None):
        called_with["niche_id"] = niche_id
        return []

    monkeypatch.setattr(spend_repo, "history", _history)
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        f"/api/v1/spend/history?niche_id={NICHE_A}",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 200
    assert called_with["niche_id"] == NICHE_A


def test_bad_days_too_small_returns_422(monkeypatch):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/spend/history?days=0",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_bad_days_too_large_returns_422(monkeypatch):
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/spend/history?days=91",
        headers={"Authorization": "Bearer mkt_tok"},
    )
    assert resp.status_code == 422


def test_days_at_boundaries_are_valid(monkeypatch):
    _reset_limiter()
    import marketer.repos.spend as spend_repo

    async def _history(*, user_id, days, niche_id=None):
        return []

    monkeypatch.setattr(spend_repo, "history", _history)
    client = _make_authed_client(monkeypatch)
    headers = {"Authorization": "Bearer mkt_tok"}
    assert client.get("/api/v1/spend/history?days=1", headers=headers).status_code == 200
    assert client.get("/api/v1/spend/history?days=90", headers=headers).status_code == 200


def test_history_without_auth_returns_401(monkeypatch):
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/api/v1/spend/history")
    assert resp.status_code == 401
