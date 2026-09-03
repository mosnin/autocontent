"""OAuth 2.1 authorization server: the security properties, end to end.

The repository layer is replaced with an in-memory store that keeps the
same shapes and the same single-statement semantics (a code can be claimed
once, a refresh token rotated once), so the whole flow runs through the
real FastAPI routes without Postgres. What is asserted here is what a
reviewer should be able to take on trust afterwards:

  * PKCE S256 is required, `plain` is refused, and a wrong verifier cannot
    exchange a code
  * redirect_uri is matched byte for byte at authorize and again at token
  * an authorization code is single use, and reusing one kills the grant
  * refresh tokens rotate, and replaying a rotated one kills the family
  * revocation is idempotent and always answers 200
  * userinfo needs a live token and the openid scope
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.models import User
from marketer.repos.oauth import (
    AuthorizationCode,
    AuthorizationRequest,
    CodeConsumption,
    Grant,
    OAuthClient,
    Token,
)
from marketer.services import oauth as oauth_service

_USER_ID = "user_oauth_test"
_EMAIL = "ana@ruizdental.example"
_CLIENT_ID = "mkoc_testclient"
_REDIRECT_URI = "https://acme.example/oauth/callback/marketer"
_SCOPES = ["openid", "profile", "email", "offline_access", "content:read"]
_VERIFIER = "n" * 64
_CHALLENGE = oauth_service.code_challenge_for(_VERIFIER)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# In-memory stand-in for marketer.repos.oauth
# ---------------------------------------------------------------------------


class FakeOAuthRepo:
    def __init__(self) -> None:
        self.clients: dict[str, OAuthClient] = {}
        self.requests: dict[UUID, AuthorizationRequest] = {}
        self.grants: dict[UUID, Grant] = {}
        self.codes: dict[str, AuthorizationCode] = {}
        self.tokens: dict[UUID, Token] = {}
        self.token_hashes: dict[str, UUID] = {}

    # -- clients ---------------------------------------------------------
    def add_client(self, **overrides: Any) -> OAuthClient:
        client = OAuthClient(
            client_id=overrides.pop("client_id", _CLIENT_ID),
            name=overrides.pop("name", "Acme Dashboard"),
            redirect_uris=overrides.pop("redirect_uris", [_REDIRECT_URI]),
            scopes=overrides.pop("scopes", list(_SCOPES)),
            **overrides,
        )
        self.clients[client.client_id] = client
        return client

    async def get_client(self, client_id: str) -> OAuthClient | None:
        return self.clients.get(client_id)

    # -- pending consent -------------------------------------------------
    async def create_authorization_request(self, **kw: Any) -> AuthorizationRequest:
        row = AuthorizationRequest(id=uuid4(), **kw)
        self.requests[row.id] = row
        return row

    async def consume_authorization_request(
        self, request_id: UUID, user_id: str
    ) -> AuthorizationRequest | None:
        row = self.requests.get(request_id)
        if row is None or row.user_id != user_id or row.consumed_at is not None:
            return None
        if row.expires_at <= _now():
            return None
        row.consumed_at = _now()
        return row

    # -- grants ----------------------------------------------------------
    async def create_grant(self, **kw: Any) -> Grant:
        grant = Grant(id=uuid4(), **kw)
        self.grants[grant.id] = grant
        return grant

    async def get_grant(self, grant_id: UUID) -> Grant | None:
        return self.grants.get(grant_id)

    async def revoke_grant(self, grant_id: UUID, reason: str) -> None:
        grant = self.grants.get(grant_id)
        if grant is not None and grant.revoked_at is None:
            grant.revoked_at = _now()
            grant.revoked_reason = reason
        for token in self.tokens.values():
            if token.grant_id == grant_id and token.revoked_at is None:
                token.revoked_at = _now()
        for code in self.codes.values():
            if code.grant_id == grant_id and code.consumed_at is None:
                code.consumed_at = _now()

    # -- codes -----------------------------------------------------------
    async def create_authorization_code(self, **kw: Any) -> None:
        code = AuthorizationCode(**kw)
        self.codes[code.code_hash] = code

    async def consume_authorization_code(self, code_hash: str) -> CodeConsumption:
        code = self.codes.get(code_hash)
        if code is None:
            return CodeConsumption(status="unknown")
        if code.consumed_at is not None:
            return CodeConsumption(status="replayed", code=code)
        code.consumed_at = _now()
        return CodeConsumption(status="consumed", code=code)

    # -- tokens ----------------------------------------------------------
    async def create_token(
        self, *, grant_id: UUID, kind: str, token_hash: str, scopes: list[str], expires_at
    ) -> Token:
        token = Token(
            id=uuid4(), grant_id=grant_id, kind=kind, scopes=scopes, expires_at=expires_at
        )
        self.tokens[token.id] = token
        self.token_hashes[token_hash] = token.id
        return token

    async def get_token_by_hash(self, token_hash: str) -> Token | None:
        token_id = self.token_hashes.get(token_hash)
        return self.tokens.get(token_id) if token_id else None

    async def rotate_refresh_token(self, token_id: UUID) -> bool:
        token = self.tokens.get(token_id)
        if token is None or token.kind != "refresh":
            return False
        if token.rotated_at is not None or token.revoked_at is not None:
            return False
        token.rotated_at = _now()
        token.revoked_at = _now()
        return True

    async def revoke_tokens_for_grant(self, grant_id: UUID, kind: str | None = None) -> int:
        count = 0
        for token in self.tokens.values():
            if token.grant_id != grant_id or token.revoked_at is not None:
                continue
            if kind is not None and token.kind != kind:
                continue
            token.revoked_at = _now()
            count += 1
        return count


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


@pytest.fixture
def signed_out(monkeypatch):
    """Swap the session resolver for one that reports nobody is signed in."""
    from backend.routes import oauth as oauth_route

    async def _none(_request):
        return None

    monkeypatch.setattr(oauth_route, "resolve_browser_session", _none)


def _authorize_params(**overrides: Any) -> dict[str, str]:
    params = {
        "response_type": "code",
        "client_id": _CLIENT_ID,
        "redirect_uri": _REDIRECT_URI,
        "scope": " ".join(_SCOPES),
        "state": "opaque-state-123",
        "code_challenge": _CHALLENGE,
        "code_challenge_method": "S256",
        "resource": "https://marketer.sh/api",
        "prompt": "consent",
    }
    params.update(overrides)
    return {k: v for k, v in params.items() if v is not None}


def _request_id(html_body: str) -> str:
    marker = 'name="request_id" value="'
    start = html_body.index(marker) + len(marker)
    return html_body[start : html_body.index('"', start)]


def _approve(client: TestClient, **overrides: Any) -> str:
    """Run the consent flow and return the authorization code."""
    page = client.get("/oauth/authorize", params=_authorize_params(**overrides))
    assert page.status_code == 200, page.text
    decision = client.post(
        "/oauth/authorize",
        data={"request_id": _request_id(page.text), "decision": "approve"},
        follow_redirects=False,
    )
    assert decision.status_code == 303
    query = parse_qs(urlsplit(decision.headers["location"]).query)
    return query["code"][0]


def _exchange(client: TestClient, code: str, **overrides: Any):
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": _VERIFIER,
        "client_id": _CLIENT_ID,
        "redirect_uri": _REDIRECT_URI,
        "resource": "https://marketer.sh/api",
    }
    form.update(overrides)
    return client.post("/oauth/token", data=form)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def test_discovery_documents_advertise_s256_only(client: TestClient) -> None:
    meta = client.get("/.well-known/oauth-authorization-server").json()
    assert meta["issuer"] == "https://marketer.sh"
    assert meta["authorization_endpoint"] == "https://marketer.sh/oauth/authorize"
    assert meta["token_endpoint"] == "https://marketer.sh/oauth/token"
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert "plain" not in meta["code_challenge_methods_supported"]
    assert meta["grant_types_supported"] == ["authorization_code", "refresh_token"]
    assert meta["response_types_supported"] == ["code"]

    resource = client.get("/.well-known/oauth-protected-resource").json()
    assert resource["authorization_servers"] == ["https://marketer.sh"]
    assert resource["bearer_methods_supported"] == ["header"]


# ---------------------------------------------------------------------------
# Authorize
# ---------------------------------------------------------------------------


def test_unknown_client_renders_a_page_and_never_redirects(client: TestClient) -> None:
    response = client.get(
        "/oauth/authorize", params=_authorize_params(client_id="mkoc_nope"), follow_redirects=False
    )
    assert response.status_code == 400
    assert "location" not in {k.lower() for k in response.headers}
    assert "not registered" in response.text


def test_redirect_uri_must_match_byte_for_byte(client: TestClient) -> None:
    """One trailing slash is a different URI, and it is not redirected to."""
    response = client.get(
        "/oauth/authorize",
        params=_authorize_params(redirect_uri=_REDIRECT_URI + "/"),
        follow_redirects=False,
    )
    assert response.status_code == 400
    assert "location" not in {k.lower() for k in response.headers}
    assert "does not exactly match" in response.text


def test_plain_pkce_is_refused(client: TestClient) -> None:
    response = client.get(
        "/oauth/authorize",
        params=_authorize_params(code_challenge_method="plain"),
        follow_redirects=False,
    )
    assert response.status_code == 303
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["error"] == ["invalid_request"]
    assert "S256" in query["error_description"][0]
    assert query["state"] == ["opaque-state-123"]


def test_missing_pkce_challenge_is_refused(client: TestClient) -> None:
    response = client.get(
        "/oauth/authorize", params=_authorize_params(code_challenge=None), follow_redirects=False
    )
    assert response.status_code == 303
    assert parse_qs(urlsplit(response.headers["location"]).query)["error"] == ["invalid_request"]


def test_scope_outside_the_client_registration_is_refused(client: TestClient) -> None:
    response = client.get(
        "/oauth/authorize",
        params=_authorize_params(scope="openid content:write"),
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert parse_qs(urlsplit(response.headers["location"]).query)["error"] == ["invalid_scope"]


def test_unknown_resource_indicator_is_refused(client: TestClient) -> None:
    response = client.get(
        "/oauth/authorize",
        params=_authorize_params(resource="https://elsewhere.example/api"),
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert parse_qs(urlsplit(response.headers["location"]).query)["error"] == ["invalid_target"]


def test_signed_out_visitor_is_sent_to_sign_in_and_back(client: TestClient, signed_out) -> None:
    response = client.get(
        "/oauth/authorize", params=_authorize_params(), follow_redirects=False
    )
    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith("https://marketer.sh/sign-in?redirect_url=")
    returned_to = parse_qs(urlsplit(location).query)["redirect_url"][0]
    assert returned_to.startswith("https://marketer.sh/oauth/authorize?")
    # The query has to survive the round trip or the flow cannot resume.
    assert "code_challenge" in returned_to and "state" in returned_to


def test_consent_screen_names_the_client_and_every_scope(client: TestClient) -> None:
    page = client.get("/oauth/authorize", params=_authorize_params())
    assert page.status_code == 200
    assert "Acme Dashboard" in page.text
    for scope in _SCOPES:
        assert scope in page.text
    assert oauth_service.SCOPE_DESCRIPTIONS["content:read"] in page.text
    assert page.headers["cache-control"] == "no-store"


def test_deny_redirects_with_access_denied(client: TestClient) -> None:
    page = client.get("/oauth/authorize", params=_authorize_params())
    response = client.post(
        "/oauth/authorize",
        data={"request_id": _request_id(page.text), "decision": "deny"},
        follow_redirects=False,
    )
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["error"] == ["access_denied"]
    assert query["state"] == ["opaque-state-123"]
    assert "code" not in query


def test_approval_returns_code_state_and_issuer(client: TestClient, repo: FakeOAuthRepo) -> None:
    page = client.get("/oauth/authorize", params=_authorize_params())
    response = client.post(
        "/oauth/authorize",
        data={"request_id": _request_id(page.text), "decision": "approve"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    location = urlsplit(response.headers["location"])
    assert f"https://{location.netloc}{location.path}" == _REDIRECT_URI
    query = parse_qs(location.query)
    assert query["state"] == ["opaque-state-123"]
    assert query["iss"] == ["https://marketer.sh"]
    code = query["code"][0]
    # Only the hash is stored.
    assert oauth_service.hash_secret(code) in repo.codes
    assert code not in repo.codes


def test_consent_request_cannot_be_answered_by_another_user(
    client: TestClient, monkeypatch
) -> None:
    page = client.get("/oauth/authorize", params=_authorize_params())
    request_id = _request_id(page.text)

    from backend.auth import AuthCtx
    from backend.routes import oauth as oauth_route

    async def _other(_request) -> AuthCtx:
        return AuthCtx(user_id="user_someone_else", email="mallory@example.com")

    monkeypatch.setattr(oauth_route, "resolve_browser_session", _other)

    response = client.post(
        "/oauth/authorize",
        data={"request_id": request_id, "decision": "approve"},
        follow_redirects=False,
    )
    assert response.status_code == 400
    assert "location" not in {k.lower() for k in response.headers}


def test_consent_request_is_single_use(client: TestClient) -> None:
    page = client.get("/oauth/authorize", params=_authorize_params())
    request_id = _request_id(page.text)
    form = {"request_id": request_id, "decision": "approve"}
    assert client.post("/oauth/authorize", data=form, follow_redirects=False).status_code == 303
    second = client.post("/oauth/authorize", data=form, follow_redirects=False)
    assert second.status_code == 400


# ---------------------------------------------------------------------------
# Token: authorization_code
# ---------------------------------------------------------------------------


def test_authorization_code_exchange(client: TestClient) -> None:
    body = _exchange(client, _approve(client)).json()
    assert body["token_type"] == "Bearer"
    assert body["access_token"].startswith(oauth_service.ACCESS_TOKEN_PREFIX)
    assert body["refresh_token"].startswith(oauth_service.REFRESH_TOKEN_PREFIX)
    assert 0 < body["expires_in"] <= 86400
    assert body["scope"] == " ".join(_SCOPES)


def test_token_response_is_not_cacheable(client: TestClient) -> None:
    response = _exchange(client, _approve(client))
    assert response.headers["cache-control"] == "no-store"


def test_pkce_mismatch_is_refused(client: TestClient, repo: FakeOAuthRepo) -> None:
    response = _exchange(client, _approve(client), code_verifier="w" * 64)
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"
    assert not repo.tokens  # nothing was issued


def test_code_verifier_is_required(client: TestClient) -> None:
    response = _exchange(client, _approve(client), code_verifier="")
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


def test_redirect_uri_mismatch_at_token_is_refused(client: TestClient) -> None:
    response = _exchange(client, _approve(client), redirect_uri="https://acme.example/other")
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"


def test_expired_code_is_refused(client: TestClient, repo: FakeOAuthRepo) -> None:
    code = _approve(client)
    stored = repo.codes[oauth_service.hash_secret(code)]
    stored.expires_at = _now() - timedelta(seconds=1)
    response = _exchange(client, code)
    assert response.status_code == 400
    assert "expired" in response.json()["error_description"]


def test_code_replay_revokes_the_grant(client: TestClient, repo: FakeOAuthRepo) -> None:
    code = _approve(client)
    first = _exchange(client, code).json()
    assert "access_token" in first

    second = _exchange(client, code)
    assert second.status_code == 400
    body = second.json()
    assert body["error"] == "invalid_grant"
    assert body["grant_revoked"] is True
    assert body["recovery_status"] == "authorization_code_replay_revoked"

    # The family is dead: the token handed to the first caller stops working.
    assert all(grant.revoked_at is not None for grant in repo.grants.values())
    probe = client.get(
        "/oauth/userinfo", headers={"authorization": f"Bearer {first['access_token']}"}
    )
    assert probe.status_code == 401


def test_code_cannot_be_spent_by_a_different_client(
    client: TestClient, repo: FakeOAuthRepo
) -> None:
    repo.add_client(client_id="mkoc_other", name="Other App", redirect_uris=[_REDIRECT_URI])
    response = _exchange(client, _approve(client), client_id="mkoc_other")
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_grant"
    assert all(grant.revoked_at is not None for grant in repo.grants.values())


# ---------------------------------------------------------------------------
# Token: refresh
# ---------------------------------------------------------------------------


def _refresh(client: TestClient, refresh_token: str, **overrides: Any):
    form = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": _CLIENT_ID,
    }
    form.update(overrides)
    return client.post("/oauth/token", data=form)


def test_refresh_rotates_the_token(client: TestClient) -> None:
    first = _exchange(client, _approve(client)).json()
    second = _refresh(client, first["refresh_token"]).json()

    assert second["refresh_token"] != first["refresh_token"]
    assert second["access_token"] != first["access_token"]
    assert second["scope"] == first["scope"]

    # The new access token works and the superseded one does not.
    assert (
        client.get(
            "/oauth/userinfo", headers={"authorization": f"Bearer {second['access_token']}"}
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/oauth/userinfo", headers={"authorization": f"Bearer {first['access_token']}"}
        ).status_code
        == 401
    )


def test_refresh_replay_revokes_the_family(client: TestClient, repo: FakeOAuthRepo) -> None:
    first = _exchange(client, _approve(client)).json()
    second = _refresh(client, first["refresh_token"]).json()

    replay = _refresh(client, first["refresh_token"])
    assert replay.status_code == 400
    body = replay.json()
    assert body["error"] == "invalid_grant"
    assert body["grant_revoked"] is True
    assert body["recovery_status"] == "refresh_token_replay_revoked"
    assert body["scope"] == " ".join(_SCOPES)

    assert all(grant.revoked_at is not None for grant in repo.grants.values())
    # Everything the family ever issued is dead, including the good tokens
    # the legitimate client was holding.
    assert (
        client.get(
            "/oauth/userinfo", headers={"authorization": f"Bearer {second['access_token']}"}
        ).status_code
        == 401
    )
    assert _refresh(client, second["refresh_token"]).status_code == 400


def test_refresh_cannot_widen_scope(client: TestClient) -> None:
    first = _exchange(client, _approve(client)).json()
    response = _refresh(client, first["refresh_token"], scope="openid content:write")
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_scope"


def test_refresh_can_narrow_scope(client: TestClient) -> None:
    first = _exchange(client, _approve(client)).json()
    body = _refresh(client, first["refresh_token"], scope="openid").json()
    assert body["scope"] == "openid"
    # Narrowed to openid only, so it no longer carries offline_access.
    assert "refresh_token" not in body


def test_refresh_token_only_issued_with_offline_access(client: TestClient) -> None:
    """A client that never asked to act in the background does not get a
    token that lets it."""
    scopes = "openid profile"
    body = _exchange(client, _approve(client, scope=scopes)).json()
    assert body["scope"] == scopes
    assert "refresh_token" not in body
    assert "access_token" in body


def test_unsupported_grant_type(client: TestClient) -> None:
    response = client.post(
        "/oauth/token", data={"grant_type": "password", "client_id": _CLIENT_ID}
    )
    assert response.status_code == 400
    assert response.json()["error"] == "unsupported_grant_type"


# ---------------------------------------------------------------------------
# Client authentication
# ---------------------------------------------------------------------------


def test_public_client_sending_a_secret_is_refused(client: TestClient) -> None:
    response = _exchange(client, _approve(client), client_secret="not-a-real-secret")
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_client"


def test_confidential_client_must_authenticate(client: TestClient, repo: FakeOAuthRepo) -> None:
    secret = "s3cret-value-for-tests"
    repo.add_client(
        client_id="mkoc_confidential",
        name="Server App",
        redirect_uris=[_REDIRECT_URI],
        client_secret_hash=oauth_service.hash_secret(secret),
    )
    code = _approve(client, client_id="mkoc_confidential")

    without = _exchange(client, code, client_id="mkoc_confidential")
    assert without.status_code == 401
    assert without.headers["www-authenticate"].startswith("Basic")

    wrong = _exchange(client, code, client_id="mkoc_confidential", client_secret="wrong")
    assert wrong.status_code == 401

    good = client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": _VERIFIER,
            "redirect_uri": _REDIRECT_URI,
        },
        auth=("mkoc_confidential", secret),
    )
    assert good.status_code == 200, good.text
    assert good.json()["token_type"] == "Bearer"


def test_unknown_client_at_token_endpoint(client: TestClient) -> None:
    response = _exchange(client, _approve(client), client_id="mkoc_ghost")
    assert response.status_code == 401
    assert response.json()["error"] == "invalid_client"


# ---------------------------------------------------------------------------
# Revocation
# ---------------------------------------------------------------------------


def test_revocation_is_idempotent_and_kills_the_family(client: TestClient) -> None:
    issued = _exchange(client, _approve(client)).json()

    first = client.post(
        "/oauth/revoke", data={"token": issued["access_token"], "client_id": _CLIENT_ID}
    )
    assert first.status_code == 200
    assert first.content == b""

    # Same call again, on a token that is now revoked.
    second = client.post(
        "/oauth/revoke", data={"token": issued["access_token"], "client_id": _CLIENT_ID}
    )
    assert second.status_code == 200
    assert second.content == b""

    # A token string that never existed is still a 200.
    third = client.post("/oauth/revoke", data={"token": "mko_at_nonsense", "client_id": _CLIENT_ID})
    assert third.status_code == 200

    assert (
        client.get(
            "/oauth/userinfo", headers={"authorization": f"Bearer {issued['access_token']}"}
        ).status_code
        == 401
    )
    # "Everything issued alongside it": the refresh token is dead too.
    assert _refresh(client, issued["refresh_token"]).status_code == 400


def test_revocation_ignores_another_clients_token(client: TestClient, repo: FakeOAuthRepo) -> None:
    issued = _exchange(client, _approve(client)).json()
    repo.add_client(client_id="mkoc_other", name="Other App", redirect_uris=[_REDIRECT_URI])

    response = client.post(
        "/oauth/revoke", data={"token": issued["access_token"], "client_id": "mkoc_other"}
    )
    assert response.status_code == 200
    # Still alive: a client cannot revoke a grant it does not own.
    assert (
        client.get(
            "/oauth/userinfo", headers={"authorization": f"Bearer {issued['access_token']}"}
        ).status_code
        == 200
    )


# ---------------------------------------------------------------------------
# Userinfo
# ---------------------------------------------------------------------------


def test_userinfo_returns_subject_and_workspace(client: TestClient) -> None:
    issued = _exchange(client, _approve(client)).json()
    body = client.get(
        "/oauth/userinfo", headers={"authorization": f"Bearer {issued['access_token']}"}
    ).json()

    assert body["sub"] == _USER_ID
    assert body["email"] == _EMAIL
    assert body["org_id"] == f"acct_{_USER_ID}"
    assert body["roles"] == ["owner"]
    assert body["scope"] == " ".join(_SCOPES)


def test_userinfo_requires_a_token(client: TestClient) -> None:
    missing = client.get("/oauth/userinfo")
    assert missing.status_code == 401
    assert "Bearer" in missing.headers["www-authenticate"]

    bogus = client.get("/oauth/userinfo", headers={"authorization": "Bearer mko_at_nope"})
    assert bogus.status_code == 401
    assert bogus.json()["error"] == "invalid_token"


def test_userinfo_rejects_an_expired_token(client: TestClient, repo: FakeOAuthRepo) -> None:
    issued = _exchange(client, _approve(client)).json()
    for token in repo.tokens.values():
        token.expires_at = _now() - timedelta(seconds=1)
    response = client.get(
        "/oauth/userinfo", headers={"authorization": f"Bearer {issued['access_token']}"}
    )
    assert response.status_code == 401
    assert "expired" in response.json()["error_description"]


def test_userinfo_needs_the_openid_scope(client: TestClient) -> None:
    issued = _exchange(client, _approve(client, scope="content:read")).json()
    response = client.get(
        "/oauth/userinfo", headers={"authorization": f"Bearer {issued['access_token']}"}
    )
    assert response.status_code == 403
    assert response.json()["error"] == "insufficient_scope"
    assert 'scope="openid"' in response.headers["www-authenticate"]


def test_userinfo_email_claim_needs_the_email_scope(client: TestClient) -> None:
    issued = _exchange(client, _approve(client, scope="openid profile")).json()
    body = client.get(
        "/oauth/userinfo", headers={"authorization": f"Bearer {issued['access_token']}"}
    ).json()
    assert "email" not in body
    assert body["org_id"] == f"acct_{_USER_ID}"


def test_a_refresh_token_is_not_an_access_token(client: TestClient) -> None:
    issued = _exchange(client, _approve(client)).json()
    response = client.get(
        "/oauth/userinfo", headers={"authorization": f"Bearer {issued['refresh_token']}"}
    )
    assert response.status_code == 401
