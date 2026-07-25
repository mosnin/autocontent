"""Route-level tests for /api/v1/connect/zernio.

No DB and no network — users_repo, social_accounts, and zernio_profiles are
monkeypatched. Auth is bypassed via FastAPI dependency_overrides.

The behaviour worth pinning here is multi-tenant safety and the reconcile
fallback: a profile is created once and reused, an unknown platform is
refused before any call is made, and a provider outage on the status page
degrades to our own rows rather than an error screen — because that page is
where users go when their connection is already broken.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.models import SocialAccount, User

_USER_ID = "user_test"
_PROFILE_ID = "prof_abc"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_user(*, profile_id: str | None = None) -> User:
    return User(
        id=_USER_ID,
        email="t@t.com",
        zernio_profile_id=profile_id,
        created_at=datetime.now(timezone.utc),
    )


def _make_account(platform: str = "tiktok", *, is_active: bool = True) -> SocialAccount:
    return SocialAccount(
        id=uuid4(),
        user_id=_USER_ID,
        zernio_account_id=f"acct_{platform}",
        zernio_profile_id=_PROFILE_ID,
        platform=platform,
        username="acme",
        is_active=is_active,
    )


def _make_authed_client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "app_url", "https://app.test")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# GET /zernio/status
# ---------------------------------------------------------------------------


def test_status_without_a_profile_is_not_connected(monkeypatch):
    _reset_limiter()
    import marketer.repos.users as users_repo

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_id=None)

    monkeypatch.setattr(users_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/connect/zernio/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"connected": False, "profile_id": None, "accounts": []}


def test_status_reconciles_against_the_provider(monkeypatch):
    """Our rows are a cache of the provider's truth. A missed
    account.connected webhook otherwise strands a user on 'not connected'
    with no way to fix it themselves."""
    _reset_limiter()
    import marketer.repos.social_accounts as accounts_repo
    import marketer.repos.users as users_repo
    import marketer.services.zernio_profiles as profiles

    seen: dict = {}

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_id=_PROFILE_ID)

    async def _list_accounts(*, profile_id: str) -> list[dict]:
        seen["profile_id"] = profile_id
        return [{"_id": "acct_tiktok", "platform": "tiktok",
                 "username": "acme", "isActive": True}]

    async def _reconcile(*, user_id, zernio_profile_id, accounts):
        seen["reconciled"] = accounts
        return [_make_account("tiktok")]

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(profiles, "list_accounts", _list_accounts)
    monkeypatch.setattr(accounts_repo, "reconcile", _reconcile)

    client = _make_authed_client(monkeypatch)
    body = client.get("/api/v1/connect/zernio/status").json()

    assert seen["profile_id"] == _PROFILE_ID
    assert body["connected"] is True
    assert body["accounts"] == [
        {"platform": "tiktok", "username": "acme", "is_active": True}
    ]


def test_status_degrades_to_local_rows_when_the_provider_is_down(monkeypatch):
    """An outage must not produce an error page on the one screen users
    visit to repair a broken connection."""
    _reset_limiter()
    import marketer.repos.social_accounts as accounts_repo
    import marketer.repos.users as users_repo
    import marketer.services.zernio_profiles as profiles

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_id=_PROFILE_ID)

    async def _boom(*, profile_id: str):
        raise RuntimeError("provider down")

    async def _list_for_user(user_id, *, platform=None, active_only=True):
        return [_make_account("reels", is_active=False)]

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(profiles, "list_accounts", _boom)
    monkeypatch.setattr(accounts_repo, "list_for_user", _list_for_user)

    client = _make_authed_client(monkeypatch)
    resp = client.get("/api/v1/connect/zernio/status")

    assert resp.status_code == 200
    body = resp.json()
    # A disconnected account is still reported — as disconnected, not absent.
    assert body["connected"] is False
    assert body["accounts"][0]["is_active"] is False


# ---------------------------------------------------------------------------
# POST /zernio/{platform}
# ---------------------------------------------------------------------------


def test_connect_creates_a_profile_once_and_reuses_it(monkeypatch):
    _reset_limiter()
    import marketer.repos.users as users_repo
    import marketer.services.zernio_profiles as profiles

    created: list[str] = []
    saved: list[str] = []
    user = _make_user(profile_id=None)

    async def _get(user_id: str) -> User | None:
        return user

    async def _create_profile(*, name: str, idempotency_key: str) -> str:
        created.append(idempotency_key)
        return _PROFILE_ID

    async def _set(user_id: str, profile_id: str) -> None:
        saved.append(profile_id)
        user.zernio_profile_id = profile_id

    async def _connect_url(*, platform, profile_id, redirect_url) -> str:
        return f"https://zernio.com/oauth/{platform}"

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(users_repo, "set_zernio_profile_id", _set)
    monkeypatch.setattr(profiles, "create_profile", _create_profile)
    monkeypatch.setattr(profiles, "connect_url", _connect_url)

    client = _make_authed_client(monkeypatch)
    first = client.post("/api/v1/connect/zernio/tiktok")
    assert first.status_code == 200
    assert first.json()["auth_url"] == "https://zernio.com/oauth/tiktok"

    second = client.post("/api/v1/connect/zernio/reels")
    assert second.status_code == 200

    # One profile per user, not one per connected platform.
    assert len(created) == 1
    assert saved == [_PROFILE_ID]


def test_connect_profile_creation_is_keyed_per_user(monkeypatch):
    """The idempotency key must be stable per user so a retried create
    replays the original instead of making a second profile."""
    _reset_limiter()
    import marketer.repos.users as users_repo
    import marketer.services.zernio_profiles as profiles

    keys: list[str] = []

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_id=None)

    async def _create_profile(*, name: str, idempotency_key: str) -> str:
        keys.append(idempotency_key)
        return _PROFILE_ID

    async def _set(user_id: str, profile_id: str) -> None:
        return None

    async def _connect_url(*, platform, profile_id, redirect_url) -> str:
        return "https://zernio.com/oauth/x"

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(users_repo, "set_zernio_profile_id", _set)
    monkeypatch.setattr(profiles, "create_profile", _create_profile)
    monkeypatch.setattr(profiles, "connect_url", _connect_url)

    client = _make_authed_client(monkeypatch)
    client.post("/api/v1/connect/zernio/tiktok")
    client.post("/api/v1/connect/zernio/shorts")

    assert keys and all(k == keys[0] for k in keys)
    assert _USER_ID in keys[0]


def test_unknown_platform_is_refused_before_any_provider_call(monkeypatch):
    _reset_limiter()
    import marketer.repos.users as users_repo
    import marketer.services.zernio_profiles as profiles

    called = False

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_id=_PROFILE_ID)

    async def _create_profile(*, name: str, idempotency_key: str) -> str:
        nonlocal called
        called = True
        return _PROFILE_ID

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(profiles, "create_profile", _create_profile)

    client = _make_authed_client(monkeypatch)
    resp = client.post("/api/v1/connect/zernio/linkedin")

    assert resp.status_code == 422
    assert not called


def test_connect_requires_app_url_for_the_oauth_redirect(monkeypatch):
    """Without a redirect target the provider would send the user nowhere
    after they authorize — fail loudly instead."""
    _reset_limiter()
    import marketer.repos.users as users_repo
    from marketer.config import settings

    async def _get(user_id: str) -> User | None:
        return _make_user(profile_id=_PROFILE_ID)

    monkeypatch.setattr(users_repo, "get", _get)

    client = _make_authed_client(monkeypatch)
    monkeypatch.setattr(settings, "app_url", "")
    resp = client.post("/api/v1/connect/zernio/tiktok")

    assert resp.status_code == 503
