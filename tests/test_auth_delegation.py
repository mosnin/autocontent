"""Agent service-token delegation in require_user / require_admin: agent ∩
the actor's role, or agent minus money without a verified actor."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from marketer.models import User
from tests.auth_helpers import JwtKit

SERVICE_TOKEN = "svc_" + "a" * 40


class _FakeRequest:
    def __init__(
        self, authorization: str | None = None, tenant: str | None = None, actor: str | None = None
    ) -> None:
        self.headers: dict[str, str] = {}
        if authorization is not None:
            self.headers["authorization"] = authorization
        if tenant is not None:
            self.headers["x-tenant-id"] = tenant
        if actor is not None:
            self.headers["x-actor-id"] = actor


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


async def test_delegation_without_actor_is_agent_minus_money(monkeypatch, enabled, failures):
    from backend import auth
    from backend import permissions as perms

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t"))
    assert ctx.user_id == "user_t"
    assert ctx.email == "t@x.io"
    assert ctx.role == "agent"
    assert ctx.actor_type == "agent"
    assert ctx.delegated is True
    assert ctx.actor_id == ""
    assert ctx.permissions == perms.ROLE_PERMISSIONS["agent"] - {"spend:approve", "campaign:launch"}
    assert "spend:approve" not in ctx.permissions
    assert "campaign:launch" not in ctx.permissions
    assert failures == []


async def test_delegation_never_gets_admin_tenant_power(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"adm": User(id="adm", email="a@x.io", role="admin")})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "adm"))
    assert ctx.role == "agent"
    assert ctx.delegated is True
    assert "api_token:create" not in ctx.permissions
    assert "workspace:delete" not in ctx.permissions


def _members(monkeypatch, members: dict, error: Exception | None = None):
    from marketer.repos import auth_identity

    async def _membership(tenant_id, person_id):
        if error is not None:
            raise error
        return members.get((tenant_id, person_id))

    monkeypatch.setattr(auth_identity, "membership_for_tenant", _membership)


def _member(role: str, **kw):
    from marketer.repos.auth_identity import Membership

    base = dict(org_id="org_t", role=role, banned=False, two_factor_enabled=False,
                require_two_factor=False, email="p@x.io")
    base.update(kw)
    return Membership(**base)


@pytest.mark.parametrize("role", ["owner", "admin", "marketer", "analyst", "billing"])
async def test_delegation_intersects_with_actor_role(monkeypatch, enabled, failures, role):
    from backend import auth
    from backend import permissions as perms

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    _members(monkeypatch, {("user_t", "person_1"): _member(role)})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t", actor="person_1"))
    assert ctx.permissions == perms.ROLE_PERMISSIONS["agent"] & perms.permissions_for(role)
    assert ctx.actor_id == "person_1"
    assert ctx.actor_email == "p@x.io"
    assert ctx.org_id == "org_t"
    assert ctx.delegated is True


async def test_marketer_actor_lets_the_agent_launch(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    _members(monkeypatch, {("user_t", "person_1"): _member("marketer")})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t", actor="person_1"))
    assert {"campaign:launch", "spend:approve"} <= ctx.permissions


async def test_analyst_actor_caps_the_agent_to_reads(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    _members(monkeypatch, {("user_t", "person_1"): _member("analyst")})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t", actor="person_1"))
    assert "content:create" not in ctx.permissions
    assert "campaign:launch" not in ctx.permissions
    assert "content:read" in ctx.permissions
    assert "agent:chat" in ctx.permissions


async def test_actor_from_another_workspace_is_not_verified(monkeypatch, enabled, failures):
    """A person who is a member somewhere else does not lift the agent."""
    from backend import auth
    from backend import permissions as perms

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    _members(monkeypatch, {("other_tenant", "person_1"): _member("owner")})
    ctx = await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t", actor="person_1"))
    assert ctx.permissions == perms.agent_permissions(None)
    assert ctx.actor_id == ""


async def test_banned_actor_is_refused(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    _members(monkeypatch, {("user_t", "person_1"): _member("owner", banned=True)})
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t", actor="person_1"))
    assert ei.value.status_code == 403


async def test_actor_without_required_two_factor_is_refused(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    _members(monkeypatch, {("user_t", "person_1"): _member("owner", require_two_factor=True)})
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t", actor="person_1"))
    assert ei.value.detail == "mfa_required"


async def test_actor_lookup_down_is_503(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"user_t": User(id="user_t", email="t@x.io")})
    _members(monkeypatch, {}, error=OSError("down"))
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "user_t", actor="person_1"))
    assert ei.value.status_code == 503


async def test_require_admin_rejects_delegated(monkeypatch, enabled, failures):
    from backend import auth

    _users(monkeypatch, {"adm": User(id="adm", email="a@x.io", role="admin")})
    with pytest.raises(HTTPException) as ei:
        await auth.require_admin(_FakeRequest(f"Bearer {SERVICE_TOKEN}", "adm"))
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
    JwtKit.install(monkeypatch)
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
    JwtKit.install(monkeypatch)
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
            created_at=datetime.now(timezone.utc), role="admin", created_by="owner",
        )

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)
    _members(monkeypatch, {})
    ctx = await auth.require_user(_FakeRequest("Bearer mkt_abc", "someone_else"))
    assert ctx.user_id == "owner"
    assert ctx.delegated is False


def test_is_agent_service_token_matches_exactly(monkeypatch, enabled):
    from backend import auth

    assert auth._is_agent_service_token(SERVICE_TOKEN) is True
    assert auth._is_agent_service_token(SERVICE_TOKEN[:-1]) is False
    assert auth._is_agent_service_token("") is False
