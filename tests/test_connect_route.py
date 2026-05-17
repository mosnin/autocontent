"""Route-level tests for /api/v1/connect.

No DB required — users_repo and ayrshare_profiles are monkeypatched.
Auth is bypassed via FastAPI dependency_overrides.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from autocontent.models import User

_USER_ID = "user_test"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_user(*, profile_key: str | None = None) -> User:
    return User(
        id=_USER_ID,
        email="t@t.com",
        ayrshare_profile_key=profile_key,
        created_at=datetime.now(timezone.utc),
    )


def _make_authed_client(monkeypatch) -> TestClient:
    from autocontent.config import settings
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
# GET /ayrshare/status
# ---------------------------------------------------------------------------

def test_status_no_profile_returns_not_connected(monkeypatch):
    """User without a profile_key → connected: false."""
    _reset_limiter()
    import autocontent.repos.users as users_repo

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_key=None)

    monkeypatch.setattr(users_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/connect/ayrshare/status",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["connected"] is False
    assert data["profile_key"] is None


def test_status_with_profile_returns_connected(monkeypatch):
    """User with a profile_key → connected: true."""
    _reset_limiter()
    import autocontent.repos.users as users_repo

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_key="pk-real-key-abc")

    monkeypatch.setattr(users_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/connect/ayrshare/status",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["connected"] is True
    assert data["profile_key"] == "pk-real-key-abc"


def test_status_user_not_in_db_returns_not_connected(monkeypatch):
    """User row not found (first login before upsert) → connected: false."""
    _reset_limiter()
    import autocontent.repos.users as users_repo

    async def _get(user_id: str) -> User | None:
        return None

    monkeypatch.setattr(users_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/connect/ayrshare/status",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["connected"] is False


def test_status_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/api/v1/connect/ayrshare/status")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /ayrshare — connect / create profile
# ---------------------------------------------------------------------------

def test_connect_ayrshare_creates_new_profile(monkeypatch):
    """User without a profile → creates one and returns profile_key + login_url."""
    _reset_limiter()
    import autocontent.repos.users as users_repo
    from autocontent.services import ayrshare_profiles

    # User has no profile key yet.
    async def _get(user_id: str) -> User | None:
        return _make_user(profile_key=None)

    set_calls: list[tuple] = []

    async def _set_key(user_id: str, key: str) -> None:
        set_calls.append((user_id, key))

    async def _create_profile(*, title: str) -> tuple:
        return "pk-new-key", "ref-123"

    async def _generate_jwt(*, profile_key: str) -> str:
        return "https://app.ayrshare.com/connect?token=jwt123"

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(users_repo, "set_ayrshare_profile_key", _set_key)
    monkeypatch.setattr(ayrshare_profiles, "create_profile", _create_profile)
    monkeypatch.setattr(ayrshare_profiles, "generate_login_jwt", _generate_jwt)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/connect/ayrshare",
        headers={"Authorization": "Bearer act_uniquetok010"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["profile_key"] == "pk-new-key"
    assert data["login_url"] == "https://app.ayrshare.com/connect?token=jwt123"
    # Profile key should have been persisted.
    assert len(set_calls) == 1
    assert set_calls[0] == (_USER_ID, "pk-new-key")


def test_connect_ayrshare_reuses_existing_profile(monkeypatch):
    """User already has profile_key → skips create, returns fresh login URL."""
    _reset_limiter()
    import autocontent.repos.users as users_repo
    from autocontent.services import ayrshare_profiles

    existing_key = "pk-existing-abc"

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_key=existing_key)

    created: list[bool] = []

    async def _create_profile(*, title: str) -> tuple:
        created.append(True)
        return "pk-should-not-be-called", "ref"

    async def _generate_jwt(*, profile_key: str) -> str:
        assert profile_key == existing_key
        return "https://app.ayrshare.com/connect?token=refreshed"

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(ayrshare_profiles, "create_profile", _create_profile)
    monkeypatch.setattr(ayrshare_profiles, "generate_login_jwt", _generate_jwt)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/connect/ayrshare",
        headers={"Authorization": "Bearer act_uniquetok011"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["profile_key"] == existing_key
    assert "refreshed" in data["login_url"]
    # create_profile must NOT have been called.
    assert len(created) == 0


def test_connect_ayrshare_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post("/api/v1/connect/ayrshare")
    assert resp.status_code == 401
