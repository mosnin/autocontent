"""Route-level tests for GET /api/v1/spend/today.

No DB required — spend_repo.today_spend_by_niche is monkeypatched.
Auth is bypassed via FastAPI dependency_overrides.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi.testclient import TestClient

_USER_ID = "user_test"
_NICHE_ID = UUID("44444444-4444-4444-4444-444444444444")


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_today_spend_empty_returns_zero(monkeypatch):
    """No spend entries → total_usd is 0."""
    _reset_limiter()
    import marketer.repos.spend as spend_repo

    async def _today(*, user_id: str) -> dict:
        return {}

    monkeypatch.setattr(spend_repo, "today_spend_by_niche", _today)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/spend/today", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    data = resp.json()
    assert Decimal(data["total_usd"]) == Decimal("0")
    assert data["by_niche"] == {}


def test_today_spend_reflects_ledger_rows(monkeypatch):
    """Spend entries by niche are summed correctly."""
    _reset_limiter()
    import marketer.repos.spend as spend_repo

    async def _today(*, user_id: str) -> dict:
        return {_NICHE_ID: Decimal("3.50")}

    monkeypatch.setattr(spend_repo, "today_spend_by_niche", _today)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/spend/today", headers={"Authorization": "Bearer mkt_tok"})
    assert resp.status_code == 200
    data = resp.json()
    assert Decimal(data["total_usd"]) == Decimal("3.50")
    # by_niche keys are stringified UUIDs.
    niche_key = str(_NICHE_ID)
    assert niche_key in data["by_niche"]
    assert Decimal(data["by_niche"][niche_key]) == Decimal("3.50")


def test_today_spend_without_auth_returns_401(monkeypatch):
    """No auth header → 401."""
    _reset_limiter()
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/api/v1/spend/today")
    assert resp.status_code == 401
