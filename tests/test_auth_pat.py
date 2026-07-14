"""require_user's PAT branch — JWT path is covered by the Clerk lib itself."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from autocontent.models import PersonalAccessToken, User


class _FakeRequest:
    def __init__(self, authorization: str | None = None) -> None:
        self.headers = {"authorization": authorization} if authorization else {}


async def test_pat_happy_path(monkeypatch):
    from backend import auth
    from autocontent.repos import tokens as tokens_repo
    from autocontent.repos import users as users_repo

    pat = PersonalAccessToken(
        id=uuid4(),
        user_id="user_abc",
        name="ci",
        prefix="act_test",
        created_at=datetime.now(timezone.utc),
    )

    async def _get(_plain: str):
        return pat

    async def _get_user(uid: str):
        return User(id=uid, email="x@y.z")

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)
    monkeypatch.setattr(users_repo, "get", _get_user)

    ctx = await auth.require_user(_FakeRequest("Bearer act_validtoken123"))
    assert ctx.user_id == "user_abc"
    assert ctx.email == ""  # PAT auth carries no email


async def test_pat_unknown_token_401(monkeypatch):
    from backend import auth
    from autocontent.repos import tokens as tokens_repo

    async def _get(_plain: str):
        return None

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)

    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest("Bearer act_unknowntoken"))
    assert ei.value.status_code == 401


async def test_pat_owner_missing_401(monkeypatch):
    from backend import auth
    from autocontent.repos import tokens as tokens_repo
    from autocontent.repos import users as users_repo

    pat = PersonalAccessToken(
        id=uuid4(),
        user_id="user_ghost",
        name="ci",
        prefix="act_test",
        created_at=datetime.now(timezone.utc),
    )

    async def _get(_plain: str):
        return pat

    async def _get_user(_uid: str):
        return None

    monkeypatch.setattr(tokens_repo, "get_by_token", _get)
    monkeypatch.setattr(users_repo, "get", _get_user)

    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest("Bearer act_validtoken123"))
    assert ei.value.status_code == 401


async def test_missing_bearer_401():
    from backend import auth
    with pytest.raises(HTTPException) as ei:
        await auth.require_user(_FakeRequest(None))
    assert ei.value.status_code == 401


async def test_non_pat_token_falls_through_to_clerk(monkeypatch):
    """A bearer that doesn't start with act_ must take the JWT path.

    We monkeypatch the Clerk decode helper to a known sentinel to confirm
    routing without standing up real JWKS.
    """
    from backend import auth
    from autocontent.repos import users as users_repo
    from autocontent.models import User

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
