"""OAuth HTTP edges not pinned by the shipped #70 suite or open #74/#76 drafts.

These are the leftover fail-closed paths: concurrent refresh loser, stale
consent, profile-scope claim filtering, revoke client-auth failures, and
a stored non-S256 PKCE method at token exchange.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from marketer.models import User
from tests.test_oauth_provider import (
    FakeOAuthRepo,
    _CLIENT_ID,
    _EMAIL,
    _SCOPES,
    _USER_ID,
    _approve,
    _authorize_params,
    _exchange,
    _now,
    _refresh,
    _request_id,
)


@pytest.fixture
def repo() -> FakeOAuthRepo:
    store = FakeOAuthRepo()
    store.add_client()
    return store


@pytest.fixture
def client(monkeypatch, repo: FakeOAuthRepo) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "oauth_issuer", "https://marketer.sh")

    from backend.rate_limit import limiter

    limiter._storage.reset()

    from backend.auth import AuthCtx
    from backend.main import create_app
    from backend.routes import oauth as oauth_route
    from marketer.repos import brand_kit as brand_kit_repo
    from marketer.repos import users as users_repo

    monkeypatch.setattr(oauth_route, "oauth_repo", repo)

    async def _get_user(user_id: str) -> User | None:
        return User(id=user_id, email=_EMAIL) if user_id == _USER_ID else None

    async def _get_kit(_user_id: str):
        return None

    monkeypatch.setattr(users_repo, "get", _get_user)
    monkeypatch.setattr(brand_kit_repo, "get", _get_kit)

    async def _session(_request) -> AuthCtx:
        return AuthCtx(user_id=_USER_ID, email=_EMAIL)

    monkeypatch.setattr(oauth_route, "resolve_browser_session", _session)

    return TestClient(create_app(), raise_server_exceptions=False)


def test_refresh_rotation_race_loser_revokes_the_family(
    client, repo: FakeOAuthRepo, monkeypatch
) -> None:
    """Two callers can both pass the rotated_at check; only one rotate wins.

    The HTTP loser must revoke the family and issue nothing — the same
    shape as a sequential replay. The repo winner is covered in
    test_pg_oauth; this pins the route branch that sees rotate=False.
    """
    first = _exchange(client, _approve(client)).json()

    async def _lose(_token_id):
        return False

    monkeypatch.setattr(repo, "rotate_refresh_token", _lose)
    loser = _refresh(client, first["refresh_token"])
    assert loser.status_code == 400
    body = loser.json()
    assert body["error"] == "invalid_grant"
    assert body["grant_revoked"] is True
    assert body["recovery_status"] == "refresh_token_replay_revoked"
    assert body["scope"] == " ".join(_SCOPES)
    assert "access_token" not in body

    assert all(grant.revoked_at is not None for grant in repo.grants.values())
    assert (
        client.get(
            "/oauth/userinfo",
            headers={"authorization": f"Bearer {first['access_token']}"},
        ).status_code
        == 401
    )


def test_expired_consent_post_does_not_mint_a_code(client, repo: FakeOAuthRepo) -> None:
    page = client.get("/oauth/authorize", params=_authorize_params())
    assert page.status_code == 200
    request_id = _request_id(page.text)
    for pending in repo.requests.values():
        pending.expires_at = _now() - timedelta(seconds=1)

    decision = client.post(
        "/oauth/authorize",
        data={"request_id": request_id, "decision": "approve"},
        follow_redirects=False,
    )
    assert decision.status_code == 400
    assert "location" not in {k.lower() for k in decision.headers}
    assert "no longer valid" in decision.text
    assert repo.grants == {}
    assert repo.codes == {}


def test_userinfo_profile_claims_need_the_profile_scope(client) -> None:
    issued = _exchange(client, _approve(client, scope="openid")).json()
    body = client.get(
        "/oauth/userinfo",
        headers={"authorization": f"Bearer {issued['access_token']}"},
    ).json()

    assert body["sub"] == _USER_ID
    assert "name" not in body
    assert "preferred_username" not in body
    assert "org_id" not in body
    assert "org_name" not in body
    assert "roles" not in body
    assert "email" not in body


def test_revoke_refuses_a_public_client_that_sends_a_secret(client) -> None:
    issued = _exchange(client, _approve(client)).json()
    response = client.post(
        "/oauth/revoke",
        data={
            "token": issued["access_token"],
            "client_id": _CLIENT_ID,
            "client_secret": "not-a-real-secret",
        },
    )
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_client"
    # Auth failure must not revoke (and must not look like RFC 7009 success).
    assert (
        client.get(
            "/oauth/userinfo",
            headers={"authorization": f"Bearer {issued['access_token']}"},
        ).status_code
        == 200
    )


def test_revoke_without_client_id_is_invalid_client(client) -> None:
    issued = _exchange(client, _approve(client)).json()
    response = client.post("/oauth/revoke", data={"token": issued["access_token"]})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_client"
    assert (
        client.get(
            "/oauth/userinfo",
            headers={"authorization": f"Bearer {issued['access_token']}"},
        ).status_code
        == 200
    )


def test_stored_non_s256_pkce_method_is_refused_at_exchange(
    client, repo: FakeOAuthRepo
) -> None:
    code = _approve(client)
    for row in repo.codes.values():
        row.code_challenge_method = "plain"

    response = _exchange(client, code)
    assert response.status_code == 400
    body = response.json()
    assert body["error"] == "invalid_grant"
    assert "code_challenge_method" in body["error_description"]
    assert "access_token" not in body
