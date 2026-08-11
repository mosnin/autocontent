"""Tests for per-route and per-IP rate limiting.

Strategy
--------
Each test builds a fresh FastAPI app via ``create_app()`` and resets the
shared in-process limiter storage between calls so tests don't leak state.
Route-level auth is bypassed via FastAPI's ``dependency_overrides`` so we can
fire requests at volume without a real DB or Clerk JWKS.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

def _reset_limiter():
    """Clear all in-process rate-limit counters."""
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _make_authed_app(monkeypatch, *, user_id: str = "user_test") -> TestClient:
    """
    Build a TestClient for create_app() with auth bypassed.

    ``require_user`` is replaced by a stub via FastAPI's dependency_overrides so
    every request is considered authenticated.  Token-repo calls are stubbed so
    the create_token route doesn't hit the DB.
    """
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=user_id, email="test@example.com")

    # Stub token repo calls used by POST /api/v1/tokens.
    from marketer.repos import tokens as tokens_repo
    from marketer.models import PersonalAccessToken
    from datetime import datetime, timezone
    from uuid import uuid4

    async def _fake_create(*, user_id, name, expires_at):
        info = PersonalAccessToken(
            id=uuid4(),
            user_id=user_id,
            name=name,
            prefix="mkt_test",
            created_at=datetime.now(timezone.utc),
            expires_at=expires_at,
        )
        return info, "mkt_testplaintext123456"

    async def _fake_list(user_id):
        return []

    monkeypatch.setattr(tokens_repo, "create", _fake_create)
    monkeypatch.setattr(tokens_repo, "list_for_user", _fake_list)

    from backend.main import create_app

    app = create_app()
    # Override auth dependency at the FastAPI level — the cleanest approach.
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# POST /api/v1/tokens — strict limit: 5/minute
# ---------------------------------------------------------------------------

def test_create_token_rate_limit_same_bearer(monkeypatch):
    """6th POST from the same bearer token within a minute → 429."""
    _reset_limiter()
    client = _make_authed_app(monkeypatch)

    headers = {"Authorization": "Bearer mkt_samebearertokenXX"}
    payload = {"name": "test-token"}

    statuses = []
    for _ in range(6):
        resp = client.post("/api/v1/tokens", json=payload, headers=headers)
        statuses.append(resp.status_code)

    assert 429 in statuses, f"Expected a 429 but got: {statuses}"
    # First 5 must succeed (201)
    assert statuses[:5] == [201] * 5
    assert statuses[5] == 429


def test_create_token_bearer_rotation_shares_ip_bucket(monkeypatch):
    """Rotating bearer strings must NOT mint fresh buckets — the limiter
    keys on client IP, so a client spraying unique bearers still trips the
    5/minute route limit. (Keying on the Authorization header would let an
    attacker bypass every limit by rotating it.)"""
    _reset_limiter()
    client = _make_authed_app(monkeypatch)

    payload = {"name": "test-token"}
    statuses = []
    for i in range(6):
        headers = {"Authorization": f"Bearer mkt_uniquebearer{i:04d}xyz"}
        resp = client.post("/api/v1/tokens", json=payload, headers=headers)
        statuses.append(resp.status_code)

    assert statuses.count(429) >= 1, f"Bearer rotation bypassed the IP bucket: {statuses}"


def test_create_token_distinct_client_ips_not_shared(monkeypatch):
    """Distinct clients (different X-Forwarded-For hops) get their own
    buckets — one tenant's burst can't 429 another's."""
    _reset_limiter()
    client = _make_authed_app(monkeypatch)

    payload = {"name": "test-token"}
    statuses = []
    for i in range(6):
        headers = {
            "Authorization": "Bearer mkt_samebearerXXXXXXXX",
            "X-Forwarded-For": f"203.0.113.{i}",
        }
        resp = client.post("/api/v1/tokens", json=payload, headers=headers)
        statuses.append(resp.status_code)

    assert 429 not in statuses, f"Got unexpected 429 across distinct IPs: {statuses}"


# ---------------------------------------------------------------------------
# GET /api/v1/tokens — strict limit: 30/minute
# ---------------------------------------------------------------------------

def test_list_tokens_rate_limit(monkeypatch):
    """31st GET from the same bearer within a minute → 429."""
    _reset_limiter()
    client = _make_authed_app(monkeypatch)

    headers = {"Authorization": "Bearer mkt_listbearertokenXX"}
    statuses = []
    for _ in range(31):
        resp = client.get("/api/v1/tokens", headers=headers)
        statuses.append(resp.status_code)

    assert 429 in statuses, f"Expected a 429 for GET /tokens but got: {statuses}"
    assert statuses[:30] == [200] * 30
    assert statuses[30] == 429


# ---------------------------------------------------------------------------
# Auth-failure throttle — invalid bearer 25 times → at least one 429
# ---------------------------------------------------------------------------

def test_invalid_bearer_throttled_after_20_failures(monkeypatch):
    """Hitting any endpoint with an invalid bearer ≥20 times triggers 429."""
    _reset_limiter()

    from marketer.config import settings

    # Use the real auth path (not stubbed) with a PAT prefix so _resolve_pat runs.
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")

    # Stub token lookup to always return None (unknown token).
    from marketer.repos import tokens as tokens_repo

    async def _not_found(_token):
        return None

    monkeypatch.setattr(tokens_repo, "get_by_token", _not_found)

    from backend.main import create_app

    app = create_app()
    client = TestClient(app, raise_server_exceptions=False)

    headers = {"Authorization": "Bearer mkt_invalidtokenXXXX"}
    statuses = []
    for _ in range(25):
        # Any protected endpoint will trigger auth; /api/v1/tokens is convenient.
        resp = client.get("/api/v1/tokens", headers=headers)
        statuses.append(resp.status_code)

    # We expect mostly 401 with at least one 429 after the 20-failure bucket fills.
    assert any(s == 429 for s in statuses), (
        f"Expected at least one 429 from auth-failure throttle; got: {statuses}"
    )


# ---------------------------------------------------------------------------
# Default app limit not exceeded by a normal smoke test
# ---------------------------------------------------------------------------

def test_default_limit_not_triggered_by_smoke(monkeypatch):
    """A handful of requests to a lightweight endpoint must all succeed."""
    _reset_limiter()
    client = _make_authed_app(monkeypatch)

    # Hit GET /healthz (no auth required, no per-route limit) a few times.
    for _ in range(10):
        resp = client.get("/healthz")
        assert resp.status_code == 200, "Smoke-test requests should not be rate-limited"
