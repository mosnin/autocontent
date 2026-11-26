"""Session JWT path of backend.auth: verification, the identity query, mfa,
tenant upsert, platform admin. Keys are generated at test time and the JWKS is
served through a monkeypatched fetch (tests/auth_helpers.JwtKit)."""
from __future__ import annotations

import time
from datetime import datetime, timezone

import jwt as pyjwt
import pytest
from fastapi import HTTPException

from marketer.models import User
from tests.auth_helpers import DEFAULT_ACTOR, DEFAULT_ORG, DEFAULT_TENANT, JwtKit, session_identity


class _URL:
    def __init__(self, path: str) -> None:
        self.path = path


class _State:
    pass


class _FakeRequest:
    def __init__(self, token: str | None, method: str = "GET", path: str = "/api/v1/jobs") -> None:
        self.headers = {"authorization": f"Bearer {token}"} if token is not None else {}
        self.method = method
        self.url = _URL(path)
        self.state = _State()


@pytest.fixture
def kit(monkeypatch):
    return JwtKit.install(monkeypatch)


@pytest.fixture
def failures(monkeypatch):
    from backend import auth

    hits: list[object] = []
    monkeypatch.setattr(auth, "_consume_failure_token", lambda req: hits.append(req))
    return hits


@pytest.fixture
def identity(monkeypatch):
    """Serve one identity row for every session query; count the queries."""
    from marketer.repos import auth_identity
    from marketer.repos import users as users_repo

    state = {"row": session_identity(), "calls": 0, "ensured": [], "error": None,
             "tenant": User(id=DEFAULT_TENANT, email="p@t.com")}

    async def _session(sid, sub, org):
        state["calls"] += 1
        if state["error"] is not None:
            raise state["error"]
        row = state["row"]
        if row is None or row.person_id != sub:
            return None
        return row

    async def _ensure(tenant_id, email):
        state["ensured"].append((tenant_id, email))
        return state["tenant"]

    monkeypatch.setattr(auth_identity, "session_identity", _session)
    monkeypatch.setattr(users_repo, "ensure", _ensure)
    return state


async def _resolve(token, **kw):
    from backend import auth

    return await auth.require_user(_FakeRequest(token, **kw))


# --------------------------------------------------------------------------- good


async def test_valid_jwt_builds_the_context(kit, identity, failures):
    ctx = await _resolve(kit.mint())
    assert ctx.user_id == DEFAULT_TENANT  # the tenant, so no query changes
    assert ctx.actor_id == DEFAULT_ACTOR
    assert ctx.actor_email == "p@t.com"
    assert ctx.org_id == DEFAULT_ORG
    assert ctx.role == "owner"
    assert ctx.actor_type == "user"
    assert ctx.delegated is False
    assert "workspace:delete" in ctx.permissions
    assert identity["ensured"] == [(DEFAULT_TENANT, "p@t.com")]
    assert failures == []


async def test_role_maps_to_catalog_permissions(kit, identity):
    from backend import permissions as perms

    identity["row"] = session_identity(member_role="analyst")
    ctx = await _resolve(kit.mint())
    assert ctx.role == "analyst"
    assert ctx.permissions == perms.permissions_for("analyst")
    assert "content:create" not in ctx.permissions


async def test_unknown_role_gets_nothing(kit, identity):
    identity["row"] = session_identity(member_role="member")  # Better Auth default, not ours
    ctx = await _resolve(kit.mint())
    assert ctx.permissions == frozenset()


async def test_identity_is_cached_for_15_seconds(kit, identity, monkeypatch):
    from backend import auth

    token = kit.mint()
    await _resolve(token)
    await _resolve(token)
    assert identity["calls"] == 1
    assert len(identity["ensured"]) == 1  # tenant upsert only on a miss
    assert kit.fetches == 1  # JWKS cached

    real = time.monotonic
    monkeypatch.setattr(auth.time, "monotonic", lambda: real() + auth.IDENTITY_TTL_SEC + 1)
    await _resolve(token)
    assert identity["calls"] == 2


async def test_cache_is_per_session_and_org(kit, identity):
    await _resolve(kit.mint(sid="s1"))
    await _resolve(kit.mint(sid="s2"))
    await _resolve(kit.mint(sid="s1", org="org_other"))
    assert identity["calls"] == 3


async def test_context_cached_on_the_request(kit, identity):
    """The policy dependency and a route's CurrentUser never resolve twice."""
    from backend import auth

    req = _FakeRequest(kit.mint())
    a = await auth.require_user(req)
    auth.reset_caches()  # even with the module caches gone
    b = await auth.require_user(req)
    assert a is b
    assert identity["calls"] == 1


# --------------------------------------------------------------------------- bad tokens


async def _expect_401(token, failures):
    with pytest.raises(HTTPException) as ei:
        await _resolve(token)
    assert ei.value.status_code == 401
    assert ei.value.detail == "invalid token"
    assert len(failures) == 1


async def test_bad_signature(kit, identity, failures):
    other = JwtKit()  # a different key, same kid
    await _expect_401(other.mint(), failures)
    assert identity["calls"] == 0


async def test_tampered_payload(kit, identity, failures):
    head, _, sig = kit.mint().split(".")
    forged = pyjwt.encode({"sub": "x"}, "k", algorithm="HS256").split(".")[1]
    await _expect_401(f"{head}.{forged}.{sig}", failures)


async def test_wrong_issuer(kit, identity, failures):
    await _expect_401(kit.mint(iss="https://evil.test"), failures)


async def test_wrong_audience(kit, identity, failures):
    await _expect_401(kit.mint(aud="someone-else"), failures)


async def test_expired(kit, identity, failures):
    await _expect_401(kit.mint(exp_in=-120), failures)


async def test_alg_none_refused(kit, identity, failures):
    now = int(time.time())
    token = pyjwt.encode(
        {"sub": DEFAULT_ACTOR, "sid": "s", "org": DEFAULT_ORG, "iss": "https://web.test",
         "aud": "marketer-api", "exp": now + 60},
        None, algorithm="none", headers={"kid": kit.kid},
    )
    await _expect_401(token, failures)


async def test_hs256_with_public_key_refused(kit, identity, failures):
    """Key confusion: an HS256 token 'signed' with the RSA public key."""
    import hmac
    import json
    from base64 import urlsafe_b64encode
    from hashlib import sha256

    from cryptography.hazmat.primitives import serialization

    def b64(b: bytes) -> str:
        return urlsafe_b64encode(b).rstrip(b"=").decode()

    pem = kit.private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": kit.kid}).encode())
    payload = b64(json.dumps({
        "sub": DEFAULT_ACTOR, "sid": "s", "org": DEFAULT_ORG, "iss": "https://web.test",
        "aud": "marketer-api", "exp": now + 60,
    }).encode())
    sig = b64(hmac.new(pem, f"{header}.{payload}".encode(), sha256).digest())
    await _expect_401(f"{header}.{payload}.{sig}", failures)


@pytest.mark.parametrize("claim", ["sub", "sid", "org", "exp", "iss", "aud"])
async def test_missing_claim(kit, identity, failures, claim):
    await _expect_401(kit.mint(drop=(claim,)), failures)


async def test_empty_claim(kit, identity, failures):
    await _expect_401(kit.mint(org=""), failures)


async def test_unknown_kid(kit, identity, failures):
    await _expect_401(kit.mint(headers={"kid": "rotated-away"}), failures)


async def test_garbage_bearer(kit, identity, failures):
    await _expect_401("not-a-jwt", failures)


async def test_jwks_ignores_non_rsa_and_private_keys():
    from backend import auth

    doc = {"keys": [
        {"kty": "oct", "k": "c2VjcmV0", "kid": "h"},
        {"kty": "RSA", "kid": "p", "n": "AQAB", "e": "AQAB", "d": "AQAB"},
        {"kty": "RSA", "kid": "es", "alg": "ES256", "n": "AQAB", "e": "AQAB"},
    ]}
    assert auth._parse_jwks(doc) == {}


async def test_jwks_unreachable_is_503_not_allow(monkeypatch, identity, failures):
    from backend import auth
    from marketer.config import settings

    monkeypatch.setattr(settings, "auth_issuer", "https://web.test")

    async def _down(url):
        raise OSError("connection refused")

    monkeypatch.setattr(auth, "_fetch_jwks", _down)
    kit = JwtKit()
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 503


async def test_issuer_unset_is_503(monkeypatch, identity):
    from marketer.config import settings

    kit = JwtKit.install(monkeypatch)
    monkeypatch.setattr(settings, "auth_issuer", "")
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 503


async def test_missing_bearer_401():
    with pytest.raises(HTTPException) as ei:
        await _resolve(None)
    assert ei.value.status_code == 401


# --------------------------------------------------------------------------- identity


async def test_revoked_or_expired_session_401(kit, identity):
    identity["row"] = None  # the query finds no live session owned by sub
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 401
    assert ei.value.detail == "session_expired"


async def test_session_of_another_person_401(kit, identity):
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint(sub="someone_else"))
    assert ei.value.status_code == 401


async def test_not_a_member_403(kit, identity):
    identity["row"] = session_identity(member_role=None)
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 403
    assert ei.value.detail == "not_a_member"
    assert identity["ensured"] == []  # no tenant row for a non-member


async def test_unknown_workspace_403(kit, identity):
    identity["row"] = session_identity(member_role=None, tenant_id=None)
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 403


async def test_banned_403(kit, identity):
    identity["row"] = session_identity(banned=True)
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 403
    assert ei.value.detail == "banned"


async def test_unverified_email_403(kit, identity):
    identity["row"] = session_identity(email_verified=False)
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 403


async def test_database_down_is_503_never_allow(kit, identity, failures):
    identity["error"] = OSError("connection refused")
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 503
    assert failures == []


async def test_tenant_upsert_failure_is_503(kit, identity, monkeypatch):
    from marketer.repos import users as users_repo

    async def _boom(*_a):
        raise OSError("db down")

    monkeypatch.setattr(users_repo, "ensure", _boom)
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 503


async def test_suspended_tenant_403(kit, identity):
    identity["tenant"] = User(id=DEFAULT_TENANT, email="p@t.com", suspended_at=datetime.now(timezone.utc))
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint())
    assert ei.value.status_code == 403


async def test_ban_expiry_is_respected():
    from datetime import timedelta

    from marketer.repos.auth_identity import _ban_holds

    now = datetime.now(timezone.utc)
    assert _ban_holds(True, None) is True
    assert _ban_holds(True, now + timedelta(hours=1)) is True
    assert _ban_holds(True, now - timedelta(hours=1)) is False
    assert _ban_holds(False, None) is False


# --------------------------------------------------------------------------- mfa


async def test_mfa_required_blocks_everything(kit, identity):
    identity["row"] = session_identity(require_two_factor=True, two_factor_enabled=False)
    with pytest.raises(HTTPException) as ei:
        await _resolve(kit.mint(), method="GET", path="/api/v1/jobs")
    assert ei.value.status_code == 403
    assert ei.value.detail == "mfa_required"


async def test_mfa_required_allows_reading_own_profile(kit, identity):
    identity["row"] = session_identity(require_two_factor=True, two_factor_enabled=False)
    ctx = await _resolve(kit.mint(), method="GET", path="/api/v1/users/me")
    assert ctx.actor_id == DEFAULT_ACTOR
    with pytest.raises(HTTPException):
        await _resolve(kit.mint(), method="PATCH", path="/api/v1/users/me")


async def test_mfa_satisfied(kit, identity):
    identity["row"] = session_identity(require_two_factor=True, two_factor_enabled=True)
    ctx = await _resolve(kit.mint())
    assert ctx.role == "owner"


# --------------------------------------------------------------------------- platform admin


async def _admin(token):
    from backend import auth

    return await auth.require_admin(_FakeRequest(token, path="/api/v1/admin/overview"))


async def test_admin_needs_two_factor(kit, identity):
    identity["row"] = session_identity(platform_role="admin", two_factor_enabled=False)
    with pytest.raises(HTTPException) as ei:
        await _admin(kit.mint())
    assert ei.value.status_code == 403
    assert ei.value.detail == "admin_requires_two_factor"


async def test_admin_with_two_factor(kit, identity):
    identity["row"] = session_identity(platform_role="admin", two_factor_enabled=True)
    ctx = await _admin(kit.mint())
    assert ctx.user_id == DEFAULT_ACTOR  # the person, not the tenant
    assert ctx.email == "p@t.com"


async def test_admin_does_not_need_a_workspace(kit, identity):
    identity["row"] = session_identity(
        platform_role="admin", two_factor_enabled=True, member_role=None, tenant_id=None
    )
    ctx = await _admin(kit.mint())
    assert ctx.user_id == DEFAULT_ACTOR


async def test_non_admin_403(kit, identity):
    identity["row"] = session_identity(platform_role="user", two_factor_enabled=True)
    with pytest.raises(HTTPException) as ei:
        await _admin(kit.mint())
    assert ei.value.status_code == 403


async def test_workspace_owner_is_not_platform_admin(kit, identity):
    identity["row"] = session_identity(platform_role="", member_role="owner", two_factor_enabled=True)
    with pytest.raises(HTTPException) as ei:
        await _admin(kit.mint())
    assert ei.value.status_code == 403


async def test_banned_admin_refused(kit, identity):
    identity["row"] = session_identity(platform_role="admin", two_factor_enabled=True, banned=True)
    with pytest.raises(HTTPException) as ei:
        await _admin(kit.mint())
    assert ei.value.status_code == 403


async def test_admin_refuses_pat_and_service_token(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "agent_service_token", "svc_" + "b" * 40)
    for token in ("mkt_abcdefgh", "svc_" + "b" * 40):
        with pytest.raises(HTTPException) as ei:
            await _admin(token)
        assert ei.value.status_code == 403


async def test_admin_database_down_503(kit, identity):
    identity["error"] = OSError("down")
    with pytest.raises(HTTPException) as ei:
        await _admin(kit.mint())
    assert ei.value.status_code == 503
