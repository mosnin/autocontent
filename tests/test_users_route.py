"""Route-level tests for GET /api/v1/users/me.

No DB required — users_repo.upsert is monkeypatched.
Auth is bypassed via FastAPI dependency_overrides.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_authed_client(monkeypatch) -> TestClient:
    """App with require_user overridden and users_repo.upsert stubbed."""
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user
    from autocontent.models import User
    from datetime import datetime, timezone

    async def _fake_require_user():
        return AuthCtx(user_id="user_test", email="t@t.com")

    # Stub upsert so no DB call is made.
    async def _fake_upsert(user_id: str, email: str) -> User:
        return User(
            id=user_id,
            email=email,
            created_at=datetime.now(timezone.utc),
        )

    import autocontent.repos.users as users_repo
    monkeypatch.setattr(users_repo, "upsert", _fake_upsert)

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Tests
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
