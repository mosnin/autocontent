"""Route-level tests for GET /api/v1/users/me and PATCH /api/v1/users/me.

No DB required — users_repo methods are monkeypatched.
Auth is bypassed via FastAPI dependency_overrides.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch, *, global_daily_cap_usd: Decimal | None = None) -> TestClient:
    """App with require_user overridden and users_repo stubs in place."""
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from autocontent.models import User
    from datetime import datetime, timezone

    _current_cap: dict[str, Decimal | None] = {"value": global_daily_cap_usd}

    async def _fake_require_user():
        return AuthCtx(user_id="user_test", email="t@t.com")

    async def _fake_upsert(user_id: str, email: str) -> User:
        return User(
            id=user_id,
            email=email,
            global_daily_cap_usd=_current_cap["value"],
            created_at=datetime.now(timezone.utc),
        )

    async def _fake_update_settings(user_id: str, *, global_daily_cap_usd=...) -> User:
        if global_daily_cap_usd is not ...:
            _current_cap["value"] = global_daily_cap_usd
        return User(
            id=user_id,
            email="t@t.com",
            global_daily_cap_usd=_current_cap["value"],
            created_at=datetime.now(timezone.utc),
        )

    import autocontent.repos.users as users_repo
    monkeypatch.setattr(users_repo, "upsert", _fake_upsert)
    monkeypatch.setattr(users_repo, "update_settings", _fake_update_settings)

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# GET /me tests
# ---------------------------------------------------------------------------

def test_me_returns_200_with_user_id(monkeypatch):
    """Authenticated GET /me returns the user's id."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)

    resp = client.get("/api/v1/users/me", headers={"Authorization": "Bearer act_testtoken"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "user_test"
    assert data["email"] == "t@t.com"


def test_me_without_auth_returns_401(monkeypatch):
    """No auth header → 401."""
    _reset_limiter()
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)

    resp = client.get("/api/v1/users/me")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /me tests
# ---------------------------------------------------------------------------

def test_patch_me_sets_global_cap(monkeypatch):
    """PATCH /me with valid global_daily_cap_usd → 200, cap stored."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)

    resp = client.patch(
        "/api/v1/users/me",
        json={"global_daily_cap_usd": "10.00"},
        headers={"Authorization": "Bearer act_testtoken"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["global_daily_cap_usd"] == "10.00"


def test_patch_me_clears_global_cap(monkeypatch):
    """PATCH /me with null global_daily_cap_usd → 200, cap cleared."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch, global_daily_cap_usd=Decimal("5.00"))

    resp = client.patch(
        "/api/v1/users/me",
        json={"global_daily_cap_usd": None},
        headers={"Authorization": "Bearer act_testtoken"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["global_daily_cap_usd"] is None


def test_patch_me_negative_cap_returns_422(monkeypatch):
    """PATCH /me with negative global_daily_cap_usd → 422 validation error."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)

    resp = client.patch(
        "/api/v1/users/me",
        json={"global_daily_cap_usd": "-1.00"},
        headers={"Authorization": "Bearer act_testtoken"},
    )

    assert resp.status_code == 422


def test_patch_me_zero_cap_is_valid(monkeypatch):
    """$0 global cap is valid (blocks all spending)."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)

    resp = client.patch(
        "/api/v1/users/me",
        json={"global_daily_cap_usd": "0.00"},
        headers={"Authorization": "Bearer act_testtoken"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["global_daily_cap_usd"] == "0.00"
