"""Unit + route-level tests for scoped PATs: scope validation, the
enforcement helpers in backend.auth, and the /api/v1/tokens route wiring —
all mocked (no DB).

Real-Postgres coverage of the migration + repo + auth-resolution behaviour
lives in tests/integration/test_pg_pat_scopes.py.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from marketer.models import PersonalAccessToken, User
from marketer.repos import tokens as tokens_repo

_USER_ID = "user_test"
_TOKEN_ID = UUID("66666666-6666-6666-6666-666666666666")


class _FakeRequest:
    def __init__(self, authorization: str | None = None, method: str = "GET") -> None:
        self.headers = {"authorization": authorization} if authorization else {}
        self.method = method
        self.client = None  # no XFF/socket peer in these unit tests

        class _State:
            pass

        self.state = _State()


def _pat(scopes: list[str], user_id: str = "user_abc") -> PersonalAccessToken:
    return PersonalAccessToken(
        id=uuid4(),
        user_id=user_id,
        name="ci",
        prefix="mkt_test",
        created_at=datetime.now(timezone.utc),
        scopes=scopes,
    )


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


# ---------------------------------------------------------------------------
# marketer.repos.tokens.validate_scopes
# ---------------------------------------------------------------------------


class TestValidateScopes:
    def test_none_defaults_to_read_write(self):
        assert tokens_repo.validate_scopes(None) == ["read", "write"]

    def test_valid_scopes_normalized_and_deduped(self):
        assert tokens_repo.validate_scopes(["write", "read", "write"]) == ["read", "write"]

    def test_admin_alone_is_valid(self):
        assert tokens_repo.validate_scopes(["admin"]) == ["admin"]

    def test_empty_list_rejected(self):
        with pytest.raises(ValueError, match="must not be empty"):
            tokens_repo.validate_scopes([])

    def test_unknown_scope_rejected(self):
        with pytest.raises(ValueError, match="unknown scope"):
            tokens_repo.validate_scopes(["read", "superuser"])

    def test_garbage_input_rejected(self):
        with pytest.raises(ValueError, match="unknown scope"):
            tokens_repo.validate_scopes(["'; drop table users; --"])


# ---------------------------------------------------------------------------
# backend.auth._check_scope
# ---------------------------------------------------------------------------


class TestCheckScope:
    def test_unscoped_ctx_always_passes(self):
        from backend.auth import AuthCtx, _check_scope

        ctx = AuthCtx(user_id="u", email="e", scopes=None)
        _check_scope(ctx, "write")  # no raise
        _check_scope(ctx, "admin")  # no raise

    def test_scoped_ctx_with_scope_passes(self):
        from backend.auth import AuthCtx, _check_scope

        ctx = AuthCtx(user_id="u", email="e", scopes=["read", "write"])
        _check_scope(ctx, "read")
        _check_scope(ctx, "write")

    def test_scoped_ctx_missing_scope_403_with_clear_message(self):
        from backend.auth import AuthCtx, _check_scope

        ctx = AuthCtx(user_id="u", email="e", scopes=["read"])
        with pytest.raises(HTTPException) as ei:
            _check_scope(ctx, "write")
        assert ei.value.status_code == 403
        assert "write" in str(ei.value.detail)
        assert "scope" in str(ei.value.detail).lower()

    def test_empty_scopes_denies_read_and_write(self):
        """Fail-closed: an empty scope set denies everything, including
        reads (since 'read' itself isn't present)."""
        from backend.auth import AuthCtx, _check_scope

        ctx = AuthCtx(user_id="u", email="e", scopes=[])
        with pytest.raises(HTTPException):
            _check_scope(ctx, "read")
        with pytest.raises(HTTPException):
            _check_scope(ctx, "write")


# ---------------------------------------------------------------------------
# backend.auth.enforce_method_scope / require_admin — resolved via
# require_user with a mocked PAT/user lookup (mirrors tests/test_auth_pat.py)
# ---------------------------------------------------------------------------


class TestEnforceMethodScope:
    async def test_get_requires_read_denied_for_write_only_token(self, monkeypatch):
        from backend import auth

        pat = _pat(["write"])  # no read scope

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123", method="GET")
        ctx = await auth.require_user(req)
        with pytest.raises(HTTPException) as ei:
            await auth.enforce_method_scope(req, ctx=ctx)
        assert ei.value.status_code == 403

    async def test_get_allowed_for_read_scoped_token(self, monkeypatch):
        from backend import auth

        pat = _pat(["read"])

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123", method="GET")
        ctx = await auth.require_user(req)
        result = await auth.enforce_method_scope(req, ctx=ctx)
        assert result.user_id == "user_abc"

    async def test_post_requires_write_denied_for_read_only_token(self, monkeypatch):
        from backend import auth

        pat = _pat(["read"])  # no write scope

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123", method="POST")
        ctx = await auth.require_user(req)
        with pytest.raises(HTTPException) as ei:
            await auth.enforce_method_scope(req, ctx=ctx)
        assert ei.value.status_code == 403

    async def test_post_allowed_for_write_scoped_token(self, monkeypatch):
        from backend import auth

        pat = _pat(["write"])

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123", method="POST")
        ctx = await auth.require_user(req)
        result = await auth.enforce_method_scope(req, ctx=ctx)
        assert result.user_id == "user_abc"

    async def test_jwt_context_unaffected_by_method(self, monkeypatch):
        """Web/JWT callers are unscoped (scopes=None) — full access on any
        method, exactly as before scoping existed."""
        from backend import auth

        async def _upsert(uid: str, email: str):
            return User(id=uid, email=email)

        monkeypatch.setattr(auth.users_repo, "upsert", _upsert)

        def _signing_key(_token):
            class K:
                key = "fake"

            return K()

        import jwt as pyjwt

        class _FakeJWKS:
            def get_signing_key_from_jwt(self, token):
                return _signing_key(token)

        monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
        monkeypatch.setattr(
            pyjwt, "decode", lambda *a, **kw: {"sub": "user_jwt", "email": "e@x"}
        )

        req = _FakeRequest("Bearer eyJsomejwt", method="DELETE")
        ctx = await auth.require_user(req)
        assert ctx.scopes is None
        result = await auth.enforce_method_scope(req, ctx=ctx)
        assert result.user_id == "user_jwt"


class TestRequireAdmin:
    async def test_admin_role_without_admin_scope_403(self, monkeypatch):
        from backend import auth

        pat = _pat(["read", "write"])  # role=admin but no admin scope

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z", role="admin")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123")
        with pytest.raises(HTTPException) as ei:
            await auth.require_admin(req)
        assert ei.value.status_code == 403

    async def test_admin_role_with_admin_scope_allowed(self, monkeypatch):
        from backend import auth

        pat = _pat(["admin"])

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z", role="admin")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123")
        ctx = await auth.require_admin(req)
        assert ctx.user_id == "user_abc"

    async def test_non_admin_role_403_regardless_of_scope(self, monkeypatch):
        from backend import auth

        pat = _pat(["admin"])  # scope present but role isn't admin

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z", role="user")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123")
        with pytest.raises(HTTPException) as ei:
            await auth.require_admin(req)
        assert ei.value.status_code == 403

    async def test_jwt_admin_unaffected(self, monkeypatch):
        """A web/JWT admin (unscoped) keeps working exactly as before."""
        from backend import auth

        async def _upsert(uid: str, email: str):
            return User(id=uid, email=email, role="admin")

        monkeypatch.setattr(auth.users_repo, "upsert", _upsert)

        def _signing_key(_token):
            class K:
                key = "fake"

            return K()

        import jwt as pyjwt

        class _FakeJWKS:
            def get_signing_key_from_jwt(self, token):
                return _signing_key(token)

        monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
        monkeypatch.setattr(
            pyjwt, "decode", lambda *a, **kw: {"sub": "user_jwt_admin", "email": "a@x"}
        )

        req = _FakeRequest("Bearer eyJsomejwt")
        ctx = await auth.require_admin(req)
        assert ctx.user_id == "user_jwt_admin"


# ---------------------------------------------------------------------------
# backend.auth.token_or_ip_key
# ---------------------------------------------------------------------------


class TestTokenOrIpKey:
    def test_keys_on_pat_id_when_present(self):
        from backend import auth

        class _State:
            pat_id = "abc-123"

        class _Req:
            state = _State()

        assert auth.token_or_ip_key(_Req()) == "pat:abc-123"

    def test_falls_back_to_client_ip_without_pat_id(self, monkeypatch):
        from backend import auth, rate_limit

        class _State:
            pass

        class _Req:
            state = _State()
            headers: dict = {}
            client = None

        monkeypatch.setattr(rate_limit, "client_ip", lambda _r: "9.9.9.9")
        assert auth.token_or_ip_key(_Req()) == "9.9.9.9"

    async def test_pat_id_stashed_on_request_state_by_resolve_pat(self, monkeypatch):
        """The rate-limit key function relies on _resolve_pat stashing the
        token id — verify that wiring end to end."""
        from backend import auth

        pat = _pat(["read", "write"])

        async def _get(_plain: str):
            return pat

        async def _get_user(uid: str):
            return User(id=uid, email="x@y.z")

        monkeypatch.setattr(tokens_repo, "get_by_token", _get)
        monkeypatch.setattr(auth.users_repo, "get", _get_user)

        req = _FakeRequest("Bearer mkt_validtoken123")
        await auth.require_user(req)
        assert req.state.pat_id == str(pat.id)
        assert auth.token_or_ip_key(req) == f"pat:{pat.id}"

    def test_two_different_tokens_get_different_keys(self):
        from backend import auth

        class _State1:
            pat_id = "tok-1"

        class _State2:
            pat_id = "tok-2"

        class _Req1:
            state = _State1()

        class _Req2:
            state = _State2()

        assert auth.token_or_ip_key(_Req1()) != auth.token_or_ip_key(_Req2())


# ---------------------------------------------------------------------------
# Route-level: /api/v1/tokens through the real FastAPI app, auth mocked via
# dependency_overrides (matches the existing pattern in test_tokens_route.py)
# ---------------------------------------------------------------------------


def _client_with_ctx(monkeypatch, ctx) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import require_user
    from backend.main import create_app

    async def _fake_require_user():
        return ctx

    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


class TestTokensRouteScopeEnforcement:
    def test_read_scoped_token_refused_on_create_write(self, monkeypatch):
        from backend.auth import AuthCtx

        _reset_limiter()
        ctx = AuthCtx(user_id=_USER_ID, email="t@t.com", scopes=["read"])
        client = _client_with_ctx(monkeypatch, ctx)
        resp = client.post(
            "/api/v1/tokens",
            json={"name": "x"},
            headers={"Authorization": "Bearer mkt_scopetest001"},
        )
        assert resp.status_code == 403
        assert "scope" in resp.json()["error"]["message"].lower()

    def test_read_scoped_token_allowed_on_list_read(self, monkeypatch):
        from backend.auth import AuthCtx

        _reset_limiter()
        monkeypatch.setattr(tokens_repo, "list_for_user", _async_return([]))
        ctx = AuthCtx(user_id=_USER_ID, email="t@t.com", scopes=["read"])
        client = _client_with_ctx(monkeypatch, ctx)
        resp = client.get(
            "/api/v1/tokens",
            headers={"Authorization": "Bearer mkt_scopetest002"},
        )
        assert resp.status_code == 200

    def test_write_scoped_token_allowed_on_create(self, monkeypatch):
        from backend.auth import AuthCtx

        _reset_limiter()
        pat = _pat(["read", "write"], user_id=_USER_ID)

        async def _create(**kwargs):
            return pat, "mkt_plaintextvalue0001"

        monkeypatch.setattr(tokens_repo, "create", _create)
        monkeypatch.setattr(tokens_repo, "compute_expires_at", lambda x: None)

        ctx = AuthCtx(user_id=_USER_ID, email="t@t.com", scopes=["write"])
        client = _client_with_ctx(monkeypatch, ctx)
        resp = client.post(
            "/api/v1/tokens",
            json={"name": "x"},
            headers={"Authorization": "Bearer mkt_scopetest003"},
        )
        assert resp.status_code == 201

    def test_write_scoped_token_refused_on_list_read(self, monkeypatch):
        from backend.auth import AuthCtx

        _reset_limiter()
        ctx = AuthCtx(user_id=_USER_ID, email="t@t.com", scopes=["write"])
        client = _client_with_ctx(monkeypatch, ctx)
        resp = client.get(
            "/api/v1/tokens",
            headers={"Authorization": "Bearer mkt_scopetest004"},
        )
        assert resp.status_code == 403

    def test_jwt_web_context_full_access(self, monkeypatch):
        """scopes=None (the default AuthCtx — as a real JWT resolution would
        produce) behaves exactly like before scoping existed: unrestricted."""
        from backend.auth import AuthCtx

        _reset_limiter()
        monkeypatch.setattr(tokens_repo, "list_for_user", _async_return([]))
        ctx = AuthCtx(user_id=_USER_ID, email="t@t.com")  # scopes defaults to None
        client = _client_with_ctx(monkeypatch, ctx)
        resp = client.get(
            "/api/v1/tokens",
            headers={"Authorization": "Bearer eyJ.web.session"},
        )
        assert resp.status_code == 200

    def test_create_rejects_garbage_scopes_with_400(self, monkeypatch):
        """Scope validation lives inside tokens_repo.create (validate_scopes
        runs before any DB access), so the real repo function can be left
        unpatched here — an invalid scope list never reaches the DB."""
        from backend.auth import AuthCtx

        _reset_limiter()
        monkeypatch.setattr(tokens_repo, "compute_expires_at", lambda x: None)

        ctx = AuthCtx(user_id=_USER_ID, email="t@t.com", scopes=["write"])
        client = _client_with_ctx(monkeypatch, ctx)
        resp = client.post(
            "/api/v1/tokens",
            json={"name": "x", "scopes": ["read", "superuser"]},
            headers={"Authorization": "Bearer mkt_scopetest005"},
        )
        assert resp.status_code == 400
        assert "scope" in resp.json()["error"]["message"].lower()

    def test_create_passes_through_valid_scopes(self, monkeypatch):
        from backend.auth import AuthCtx

        _reset_limiter()
        pat = _pat(["read"], user_id=_USER_ID)
        captured: dict = {}

        async def _create(**kwargs):
            captured.update(kwargs)
            return pat, "mkt_plaintextvalue0002"

        monkeypatch.setattr(tokens_repo, "create", _create)
        monkeypatch.setattr(tokens_repo, "compute_expires_at", lambda x: None)

        ctx = AuthCtx(user_id=_USER_ID, email="t@t.com", scopes=["write"])
        client = _client_with_ctx(monkeypatch, ctx)
        resp = client.post(
            "/api/v1/tokens",
            json={"name": "x", "scopes": ["read"]},
            headers={"Authorization": "Bearer mkt_scopetest006"},
        )
        assert resp.status_code == 201
        assert captured["scopes"] == ["read"]


def _async_return(value):
    async def _fn(*args, **kwargs):
        return value

    return _fn
