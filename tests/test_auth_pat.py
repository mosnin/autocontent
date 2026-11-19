"""require_user's personal-access-token branch: role on the token, capped by
the creator's current role; refused when the creator left the workspace,
except legacy tokens whose creator is the tenant itself."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from marketer.models import PersonalAccessToken, User
from marketer.repos.auth_identity import Membership


class _FakeRequest:
    def __init__(self, authorization: str | None = None) -> None:
        self.headers = {"authorization": authorization} if authorization else {}


def _pat(**kw) -> PersonalAccessToken:
    base = dict(
        id=uuid4(), user_id="user_abc", name="ci", prefix="mkt_test",
        created_at=datetime.now(timezone.utc), role="admin", created_by="user_abc",
    )
    base.update(kw)
    return PersonalAccessToken(**base)


def _member(role: str, **kw) -> Membership:
    base = dict(org_id="org_abc", role=role, banned=False, two_factor_enabled=True,
                require_two_factor=False, email="creator@x.io")
    base.update(kw)
    return Membership(**base)


@pytest.fixture
def world(monkeypatch):
    """Stub the token, tenant and membership lookups."""
    from marketer.repos import auth_identity
    from marketer.repos import tokens as tokens_repo
    from marketer.repos import users as users_repo

    state = {"pat": _pat(), "users": {"user_abc": User(id="user_abc", email="x@y.z")},
             "members": {}, "error": None, "lookups": []}

    async def _get(_plain):
        return state["pat"]

    async def _get_user(uid):
        return state["users"].get(uid)

    async def _membership(tenant_id, person_id):
        state["lookups"].append((tenant_id, person_id))
        if state["error"] is not None:
            raise state["error"]
        return state["members"].get((tenant_id, person_id))

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)
    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(auth_identity, "membership_for_tenant", _membership)
    return state


async def _resolve(token="Bearer mkt_validtoken123"):
    from backend import auth

    return await auth.require_user(_FakeRequest(token))


async def test_legacy_token_keeps_admin(world):
    """Created before workspaces: creator is the tenant, role admin."""
    from backend import permissions as perms

    ctx = await _resolve()
    assert ctx.user_id == "user_abc"
    assert ctx.email == "x@y.z"
    assert ctx.role == "admin"
    assert ctx.actor_type == "token"
    assert ctx.actor_id == "user_abc"
    assert ctx.permissions == perms.permissions_for("admin")
    assert ctx.delegated is False


async def test_legacy_token_capped_when_tenant_person_is_a_member(world):
    """A Clerk-migrated workspace's tenant id is its owner's person id; their
    current role still caps the token."""
    from backend import permissions as perms

    world["members"][("user_abc", "user_abc")] = _member("analyst")
    ctx = await _resolve()
    assert ctx.permissions == perms.permissions_for("admin") & perms.permissions_for("analyst")
    assert ctx.org_id == "org_abc"


async def test_token_acts_with_its_role(world):
    from backend import permissions as perms

    world["pat"] = _pat(role="marketer", created_by="person_1")
    world["members"][("user_abc", "person_1")] = _member("admin")
    ctx = await _resolve()
    assert ctx.role == "marketer"
    assert ctx.actor_id == "person_1"
    assert ctx.actor_email == "creator@x.io"
    assert ctx.permissions == perms.permissions_for("marketer")


async def test_token_shrinks_when_creator_is_demoted(world):
    from backend import permissions as perms

    world["pat"] = _pat(role="admin", created_by="person_1")
    world["members"][("user_abc", "person_1")] = _member("analyst")
    ctx = await _resolve()
    assert ctx.permissions == perms.permissions_for("analyst")
    assert "api_token:create" not in ctx.permissions


async def test_token_refused_when_creator_left(world):
    world["pat"] = _pat(role="marketer", created_by="person_gone")
    with pytest.raises(HTTPException) as ei:
        await _resolve()
    assert ei.value.status_code == 401
    assert world["lookups"] == [("user_abc", "person_gone")]


async def test_token_refused_when_creator_banned(world):
    world["pat"] = _pat(role="marketer", created_by="person_1")
    world["members"][("user_abc", "person_1")] = _member("admin", banned=True)
    with pytest.raises(HTTPException) as ei:
        await _resolve()
    assert ei.value.status_code == 403


async def test_membership_lookup_down_is_503(world):
    world["pat"] = _pat(role="marketer", created_by="person_1")
    world["error"] = OSError("db down")
    with pytest.raises(HTTPException) as ei:
        await _resolve()
    assert ei.value.status_code == 503


async def test_pat_unknown_token_401(world):
    world["pat"] = None
    with pytest.raises(HTTPException) as ei:
        await _resolve("Bearer mkt_unknowntoken")
    assert ei.value.status_code == 401


async def test_pat_owner_missing_401(world):
    world["users"] = {}
    with pytest.raises(HTTPException) as ei:
        await _resolve()
    assert ei.value.status_code == 401


async def test_pat_suspended_tenant_403(world):
    world["users"]["user_abc"] = User(id="user_abc", email="x", suspended_at=datetime.now(timezone.utc))
    with pytest.raises(HTTPException) as ei:
        await _resolve()
    assert ei.value.status_code == 403


async def test_missing_bearer_401():
    from backend import auth

    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(None))
    assert ei.value.status_code == 401


async def test_non_pat_token_takes_the_jwt_path(monkeypatch):
    """A bearer that doesn't start with mkt_ is verified as a session JWT."""
    from backend import auth

    seen: list[str] = []

    async def _jwt(token, request):
        seen.append(token)
        return auth.AuthCtx(user_id="t")

    monkeypatch.setattr(auth, "_resolve_session_jwt", _jwt)
    ctx = await auth.require_user(_FakeRequest("Bearer eyJsomejwt"))
    assert ctx.user_id == "t"
    assert seen == ["eyJsomejwt"]
