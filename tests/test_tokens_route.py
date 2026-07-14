"""Route-level tests for /api/v1/tokens.

Distinct from test_tokens_repo.py which only tests pure helper functions.
These tests go through the FastAPI app via TestClient.

Auth is bypassed via FastAPI dependency_overrides.
Rate-limit state is reset before tests that create tokens to stay under the
5/minute cap (the rate-limit assertion tests live in test_rate_limit.py).
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi.testclient import TestClient

from autocontent.models import PersonalAccessToken

_USER_ID = "user_test"
_TOKEN_ID = UUID("55555555-5555-5555-5555-555555555555")
_PLAINTEXT = "act_testplaintextfaketoken12"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _make_pat(token_id: UUID | None = None) -> PersonalAccessToken:
    return PersonalAccessToken(
        id=token_id or _TOKEN_ID,
        user_id=_USER_ID,
        name="my-token",
        prefix="act_test",
        created_at=datetime.now(timezone.utc),
    )


def _make_authed_client(monkeypatch) -> TestClient:
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# POST / — create token
# ---------------------------------------------------------------------------

def test_create_token_returns_201_with_plaintext(monkeypatch):
    """POST /tokens returns 201 with plaintext + info; plaintext is present."""
    _reset_limiter()
    import autocontent.repos.tokens as tokens_repo

    async def _create(*, user_id: str, name: str, expires_at) -> tuple:
        return _make_pat(), _PLAINTEXT

    monkeypatch.setattr(tokens_repo, "create", _create)
    monkeypatch.setattr(tokens_repo, "compute_expires_at", lambda x: None)

    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/tokens",
        json={"name": "my-token"},
        headers={"Authorization": "Bearer act_uniquetok001"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["token"] == _PLAINTEXT
    assert data["info"]["name"] == "my-token"


def test_create_token_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.post("/api/v1/tokens", json={"name": "x"})
    assert resp.status_code == 401


def test_create_token_empty_name_returns_422(monkeypatch):
    """min_length=1 validation on name field → 422."""
    _reset_limiter()
    client = _make_authed_client(monkeypatch)
    resp = client.post(
        "/api/v1/tokens",
        json={"name": ""},
        headers={"Authorization": "Bearer act_uniquetok002"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET / — list tokens
# ---------------------------------------------------------------------------

def test_list_tokens_returns_200_without_plaintext(monkeypatch):
    """GET /tokens returns list; plaintext must NOT appear in the response."""
    _reset_limiter()
    import autocontent.repos.tokens as tokens_repo

    pat = _make_pat()

    async def _list(user_id: str):
        return [pat]

    monkeypatch.setattr(tokens_repo, "list_for_user", _list)

    client = _make_authed_client(monkeypatch)
    resp = client.get(
        "/api/v1/tokens",
        headers={"Authorization": "Bearer act_uniquetok003"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    # Plaintext must never appear in list response — only the prefix hint.
    assert _PLAINTEXT not in str(data)
    assert "prefix" in data[0]


def test_list_tokens_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/api/v1/tokens")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# DELETE /{id} — revoke
# ---------------------------------------------------------------------------

def test_revoke_token_returns_204(monkeypatch):
    """DELETE /tokens/{id} → 204 No Content."""
    _reset_limiter()
    import autocontent.repos.tokens as tokens_repo

    revoked: list[UUID] = []

    async def _revoke(token_id: UUID, user_id: str) -> bool:
        revoked.append(token_id)
        return True

    monkeypatch.setattr(tokens_repo, "revoke", _revoke)

    client = _make_authed_client(monkeypatch)
    resp = client.delete(
        f"/api/v1/tokens/{_TOKEN_ID}",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 204
    assert _TOKEN_ID in revoked


def test_revoke_unknown_token_returns_404(monkeypatch):
    """DELETE of non-existent token → 404."""
    _reset_limiter()
    import autocontent.repos.tokens as tokens_repo

    async def _revoke(token_id: UUID, user_id: str) -> bool:
        return False

    monkeypatch.setattr(tokens_repo, "revoke", _revoke)

    client = _make_authed_client(monkeypatch)
    resp = client.delete(
        f"/api/v1/tokens/{_TOKEN_ID}",
        headers={"Authorization": "Bearer act_tok"},
    )
    assert resp.status_code == 404


def test_revoke_token_without_auth_returns_401(monkeypatch):
    """No auth → 401."""
    _reset_limiter()
    from autocontent.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.delete(f"/api/v1/tokens/{_TOKEN_ID}")
    assert resp.status_code == 401
