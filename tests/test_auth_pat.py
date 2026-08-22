"""require_user's PAT branch — JWT path is covered by the Clerk lib itself."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from marketer.models import PersonalAccessToken, User


class _FakeRequest:
    def __init__(self, authorization: str | None = None) -> None:
        self.headers = {"authorization": authorization} if authorization else {}


async def test_pat_happy_path(monkeypatch):
    from backend import auth
    from marketer.repos import tokens as tokens_repo
    from marketer.repos import users as users_repo

    pat = PersonalAccessToken(
        id=uuid4(),
        user_id="user_abc",
        name="ci",
        prefix="mkt_test",
        created_at=datetime.now(timezone.utc),
    )

    async def _get(_plain: str):
        return pat

    async def _get_user(uid: str):
        return User(id=uid, email="x@y.z")

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)
    monkeypatch.setattr(users_repo, "get", _get_user)

    ctx = await auth.require_user(_FakeRequest("Bearer mkt_validtoken123"))
    assert ctx.user_id == "user_abc"
    # PAT auth now carries the owner's stored email (from the user row).
    assert ctx.email == "x@y.z"
    assert ctx.role == "user"


async def test_pat_unknown_token_401(monkeypatch):
    from backend import auth
    from marketer.repos import tokens as tokens_repo

    async def _get(_plain: str):
        return None

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)

    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest("Bearer mkt_unknowntoken"))
    assert ei.value.status_code == 401


async def test_pat_owner_missing_401(monkeypatch):
    from backend import auth
    from marketer.repos import tokens as tokens_repo
    from marketer.repos import users as users_repo

    pat = PersonalAccessToken(
        id=uuid4(),
        user_id="user_ghost",
        name="ci",
        prefix="mkt_test",
        created_at=datetime.now(timezone.utc),
    )

    async def _get(_plain: str):
        return pat

    async def _get_user(_uid: str):
        return None

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)
    monkeypatch.setattr(users_repo, "get", _get_user)

    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest("Bearer mkt_validtoken123"))
    assert ei.value.status_code == 401


async def test_missing_bearer_401():
    from backend import auth
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(None))
    assert ei.value.status_code == 401


async def test_non_pat_token_falls_through_to_clerk(monkeypatch):
    """A bearer that doesn't start with mkt_ must take the JWT path.

    We monkeypatch the Clerk decode helper to a known sentinel to confirm
    routing without standing up real JWKS.
    """
    from backend import auth
    from marketer.repos import users as users_repo
    from marketer.models import User

    called: dict = {}

    async def _upsert(uid: str, email: str):
        called["upsert"] = (uid, email)
        return User(id=uid, email=email)

    monkeypatch.setattr(users_repo, "upsert", _upsert)

    def _signing_key(_token):
        class K:
            key = "fake"
        return K()

    import jwt as pyjwt

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            return _signing_key(token)

    monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
    monkeypatch.setattr(pyjwt, "decode", lambda *a, **kw: {"sub": "user_jwt", "email": "e@x"})

    ctx = await auth.require_user(_FakeRequest("Bearer eyJsomejwt"))
    assert ctx.user_id == "user_jwt"
    assert called["upsert"] == ("user_jwt", "e@x")


def test_expected_issuer_prefers_explicit(monkeypatch):
    from backend import auth
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_issuer", "https://issuer.example")
    monkeypatch.setattr(
        settings, "clerk_jwks_url", "https://other.clerk.dev/.well-known/jwks.json"
    )
    assert auth._expected_issuer() == "https://issuer.example"


def test_expected_issuer_derived_from_jwks_url(monkeypatch):
    from backend import auth
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_issuer", "")
    monkeypatch.setattr(
        settings, "clerk_jwks_url", "https://acme.clerk.accounts.dev/.well-known/jwks.json"
    )
    # Derived by stripping the well-known suffix — matches Clerk's iss claim.
    assert auth._expected_issuer() == "https://acme.clerk.accounts.dev"


def test_expected_issuer_none_when_undeterminable(monkeypatch):
    from backend import auth
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_issuer", "")
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://proxy.example/keys")
    # Non-standard JWKS path → can't derive; issuer verification is skipped.
    assert auth._expected_issuer() is None


async def test_jwt_decode_verifies_issuer_and_optional_audience(monkeypatch):
    """Audience is optional config, but when set it must actually reach
    jwt.decode — otherwise a token minted for another frontend on the
    same Clerk instance is accepted. Issuer is always passed when known."""
    from backend import auth
    from marketer.config import settings
    from marketer.models import User
    from marketer.repos import users as users_repo

    async def _upsert(uid: str, email: str):
        return User(id=uid, email=email)

    monkeypatch.setattr(users_repo, "upsert", _upsert)
    monkeypatch.setattr(settings, "clerk_issuer", "https://issuer.example")
    monkeypatch.setattr(settings, "clerk_audience", "marketer.sh")

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            class K:
                key = "fake"
            return K()

    seen: dict = {}

    def _decode(*_a, **kw):
        seen.update(kw)
        return {"sub": "user_jwt", "email": "e@x"}

    import jwt as pyjwt

    monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
    monkeypatch.setattr(pyjwt, "decode", _decode)

    ctx = await auth.require_user(_FakeRequest("Bearer eyJsomejwt"))
    assert ctx.user_id == "user_jwt"
    assert seen["issuer"] == "https://issuer.example"
    assert seen["audience"] == "marketer.sh"
    assert seen["options"]["verify_iss"] is True
    assert seen["options"]["verify_aud"] is True


async def test_jwt_skips_audience_when_unconfigured(monkeypatch):
    from backend import auth
    from marketer.config import settings
    from marketer.models import User
    from marketer.repos import users as users_repo

    async def _upsert(uid: str, email: str):
        return User(id=uid, email=email)

    monkeypatch.setattr(users_repo, "upsert", _upsert)
    monkeypatch.setattr(settings, "clerk_issuer", "https://issuer.example")
    monkeypatch.setattr(settings, "clerk_audience", "")

    class _FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            class K:
                key = "fake"
            return K()

    seen: dict = {}

    def _decode(*_a, **kw):
        seen.update(kw)
        return {"sub": "user_jwt", "email": "e@x"}

    import jwt as pyjwt

    monkeypatch.setattr(auth, "_jwks", lambda: _FakeJWKS())
    monkeypatch.setattr(pyjwt, "decode", _decode)

    await auth.require_user(_FakeRequest("Bearer eyJsomejwt"))
    assert seen["audience"] is None
    assert seen["options"]["verify_aud"] is False
    assert seen["options"]["verify_iss"] is True
