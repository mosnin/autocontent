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
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from marketer.models import User
    from datetime import datetime, timezone

    _current_cap: dict[str, Decimal | None] = {"value": global_daily_cap_usd}
    _emails: dict[str, bool] = {"value": True}

    async def _fake_require_user():
        return AuthCtx(user_id="user_test", email="t@t.com")

    async def _fake_get(user_id: str) -> User:
        return User(
            id=user_id,
            email="t@t.com",
            global_daily_cap_usd=_current_cap["value"],
            email_notifications=_emails["value"],
            created_at=datetime.now(timezone.utc),
        )

    async def _fake_upsert(user_id: str, email: str) -> User:
        return User(
            id=user_id,
            email=email,
            global_daily_cap_usd=_current_cap["value"],
            email_notifications=_emails["value"],
            created_at=datetime.now(timezone.utc),
        )

    async def _fake_update_settings(
        user_id: str, *, global_daily_cap_usd=..., email_notifications=...
    ) -> User:
        if global_daily_cap_usd is not ...:
            _current_cap["value"] = global_daily_cap_usd
        if email_notifications is not ...:
            _emails["value"] = email_notifications
        return await _fake_get(user_id)

    import marketer.repos.users as users_repo
    monkeypatch.setattr(users_repo, "get", _fake_get)
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

    resp = client.get("/api/v1/users/me", headers={"Authorization": "Bearer mkt_testtoken"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "user_test"
    assert data["email"] == "t@t.com"


def test_me_without_auth_returns_401(monkeypatch):
    """No auth header → 401."""
    _reset_limiter()
    from marketer.config import settings
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
        headers={"Authorization": "Bearer mkt_testtoken"},
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
        headers={"Authorization": "Bearer mkt_testtoken"},
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
        headers={"Authorization": "Bearer mkt_testtoken"},
    )

    assert resp.status_code == 422


def test_patch_me_zero_cap_is_valid(monkeypatch):
    """$0 global cap is valid (blocks all spending)."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)

    resp = client.patch(
        "/api/v1/users/me",
        json={"global_daily_cap_usd": "0.00"},
        headers={"Authorization": "Bearer mkt_testtoken"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["global_daily_cap_usd"] == "0.00"


def test_patch_me_toggles_email_notifications(monkeypatch):
    """PATCH /me with email_notifications=false stores the opt-out."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)

    resp = client.patch(
        "/api/v1/users/me",
        json={"email_notifications": False},
        headers={"Authorization": "Bearer mkt_testtoken"},
    )
    assert resp.status_code == 200
    assert resp.json()["email_notifications"] is False


def test_patch_me_email_pref_does_not_clobber_cap(monkeypatch):
    """Sending only email_notifications must leave the spend-cap untouched —
    the sentinel-based repo update forwards only the keys present."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch, global_daily_cap_usd=Decimal("7.50"))

    resp = client.patch(
        "/api/v1/users/me",
        json={"email_notifications": False},
        headers={"Authorization": "Bearer mkt_testtoken"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email_notifications"] is False
    # The cap safety net survives — it wasn't in the request body.
    assert data["global_daily_cap_usd"] == "7.50"


def test_patch_me_empty_body_is_noop(monkeypatch):
    """PATCH {} changes nothing and returns current state (200)."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch, global_daily_cap_usd=Decimal("5.00"))

    resp = client.patch(
        "/api/v1/users/me",
        json={},
        headers={"Authorization": "Bearer mkt_testtoken"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["global_daily_cap_usd"] == "5.00"
    assert data["email_notifications"] is True
