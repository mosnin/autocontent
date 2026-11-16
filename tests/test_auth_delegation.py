"""Agent service-token delegation in require_user / require_admin."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from marketer.models import User

SERVICE_TOKEN = "svc_" + "a" * 40


class _FakeRequest:
    def __init__(self, authorization: str | None = None, tenant: str | None = None) -> None:
        self.headers: dict[str, str] = {}
        if authorization is not None:
            self.headers["authorization"] = authorization
        if tenant is not None:
            self.headers["x-tenant-id"] = tenant


@pytest.fixture
def failures(monkeypatch):
    """Record auth-failure bucket hits instead of touching the limiter."""
    from backend import auth

    hits: list[object] = []
    monkeypatch.setattr(auth, "_consume_failure_token", lambda req: hits.append(req))
    return hits


@pytest.fixture
def enabled(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "agent_service_token", SERVICE_TOKEN)


def _users(monkeypatch, users: dict[str, User]) -> None:
    from marketer.repos import users as users_repo

    async def _get(uid: str):
        return users.get(uid)

    async def _upsert(*_a, **_k):  # delegation must never mint accounts
        raise AssertionError("upsert must not be called on the delegation path")

    monkeypatch.setattr(users_repo, "get", _get)
    monkeypatch.setattr(users_repo, "upsert", _upsert)


async def test_delegation_happy_path(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t"))
    assert ctx.user_id == "user_t"
    assert ctx.email == "t@x.io"
    assert ctx.role == "user"
    assert ctx.delegated is True
    assert failures == []


async def test_delegation_forces_user_role_for_admin_tenant(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"adm": User(id="adm", email="a@x.io", role="admin")})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "adm"))
    assert ctx.role == "user"
    assert ctx.delegated is True


async def test_require_admin_rejects_delegated(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"adm": User(id="adm", email="a@x.io", role="admin")})
    with pytest.raises(HTTPException) as ei:
        await auth.require_admin(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "adm"))
    assert ei.value.status_code == 403


async def test_require_admin_rejects_delegated_ctx_even_if_role_admin(monkeypatch):
    """Belt and braces: a delegated ctx is refused even if role were admin."""
    from backend import auth

    async def _fake_user(_req):
        return auth.AuthCtx(user_id="adm", email="", role="admin", delegated=True)

    monkeypatch.setattr(auth, "require_user", _fake_user)
    with pytest.raises(HTTPException) as ei:
        await auth.require_admin(_FakeRequest("Bearer x"))
    assert ei.value.status_code == 403


async def test_delegation_missing_tenant_header_401(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {})
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}"))
    assert ei.value.status_code == 401


async def test_delegation_unknown_tenant_401(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {})
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "ghost"))
    assert ei.value.status_code == 401
    assert len(failures) == 1


async def test_delegation_suspended_tenant_403(monkeypatch, enabled, failures):
    from backend import auth

    _users(
        monkeypatch,
        {"sus": User(id="sus", email="s@x.io", suspended_at=datetime.now(timezone.utc))},
    )
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "sus"))
    assert ei.value.status_code == 403


async def test_wrong_service_token_takes_normal_failure_path(monkeypatch, enabled, failures):
    """A near-miss token is not delegation: it falls through to the JWT path,
    fails there, and counts against the auth-failure bucket."""
    from backend import auth

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            import jwt as pyjwt

            raise pyjwt.InvalidTokenError("bad")

    monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}x", "user_t"))
    assert ei.value.status_code == 401
    assert len(failures) == 1


async def test_disabled_empty_bearer_never_matches(monkeypatch, failures):
    """With the setting empty, an empty bearer must not be treated as the
    service token (it goes down the JWT path and fails)."""
    from backend import auth
    from marketer.config import settings

    monkeypatch.setattr(settings, "agent_service_token", "")
    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            import jwt as pyjwt

            raise pyjwt.InvalidTokenError("empty")

    monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
    assert auth._is_agent_service_token("") is False
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest("Bearer ", "user_t"))
    assert ei.value.status_code == 401
    assert len(failures) == 1


async def test_disabled_ignores_tenant_header_for_pat(monkeypatch, failures):
    """When disabled, x-tenant-id is ignored: a PAT still resolves to its owner."""
    from uuid import uuid4

    from backend import auth
    from marketer.config import settings
    from marketer.models import PersonalAccessToken
    from marketer.repos import tokens as tokens_repo

    monkeypatch.setattr(settings, "agent_service_token", "")
    _users(monkeypatch, {"owner": User(id="owner", email="o@x.io")})

    async def _get(_plain: str):
        return PersonalAccessToken(
            id=uuid4(), user_id="owner", name="ci", prefix="mkt_test",
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)
    ctx = await auth.require_user(_FakeRequest("Bearer mkt_abc", "someone_else"))
    assert ctx.user_id == "owner"
    assert ctx.delegated is False


def test_is_agent_service_token_matches_exactly(monkeypatch, enabled):
    from backend import auth

    assert auth._is_agent_service_token(SERVICE_TOKEN) is True
    assert auth._is_agent_service_token(SERVICE_TOKEN[:-1]) is False
    assert auth._is_agent_service_token("") is False
