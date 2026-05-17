"""Tests for /healthz and /healthz/deep endpoints."""
from __future__ import annotations

from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_client(monkeypatch) -> TestClient:
    """Return a TestClient with rate-limiter resets so tests are isolated."""
    # Patch settings *before* importing the app so the rate_limit module
    # picks up the stub values.
    from autocontent.config import settings

    # Ensure JWKS URL looks set by default so we can toggle it per-test.
    # (Each test that needs it missing can set it to "" locally.)
    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")

    from backend.main import create_app

    app = create_app()
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# /healthz — cheap liveness
# ---------------------------------------------------------------------------

def test_healthz_always_200(monkeypatch):
    client = _make_client(monkeypatch)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# ---------------------------------------------------------------------------
# /healthz/deep — happy path
# ---------------------------------------------------------------------------

def test_healthz_deep_all_healthy(monkeypatch):
    """When DB and Clerk JWKS are reachable, deep probe returns 200."""
    from autocontent.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "xai_api_key", "")
    monkeypatch.setattr(settings, "ayrshare_api_key", "ay-test")

    # Patch get_pool to return a fake pool.
    class _FakePool:
        async def fetchval(self, query: str):
            return 1

    async def _fake_get_pool():
        return _FakePool()

    import backend.routes.healthz as healthz_mod
    monkeypatch.setattr(healthz_mod, "get_pool", _fake_get_pool)

    # Patch httpx.AsyncClient to return a 200 HEAD response.
    class _FakeResponse:
        status_code = 200

        def raise_for_status(self):
            pass

    class _FakeHTTPClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def head(self, url: str):
            return _FakeResponse()

    monkeypatch.setattr(healthz_mod.httpx, "AsyncClient", lambda **kw: _FakeHTTPClient())

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/healthz/deep")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["checks"]["db"]["ok"] is True
    assert "latency_ms" in data["checks"]["db"]
    assert data["checks"]["clerk_jwks"]["ok"] is True
    assert data["checks"]["openai_api_key"] == {"configured": True}
    assert data["checks"]["xai_api_key"] == {"configured": False}
    assert data["checks"]["ayrshare_api_key"] == {"configured": True}


# ---------------------------------------------------------------------------
# /healthz/deep — DB unreachable
# ---------------------------------------------------------------------------

def test_healthz_deep_db_failure(monkeypatch):
    """When get_pool raises, deep probe returns 503 with db.ok=False."""
    from autocontent.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")

    async def _failing_get_pool():
        raise ConnectionRefusedError("postgres is down")

    import backend.routes.healthz as healthz_mod
    monkeypatch.setattr(healthz_mod, "get_pool", _failing_get_pool)

    # Patch httpx so JWKS check succeeds (only DB should fail).
    class _FakeResponse:
        status_code = 200

        def raise_for_status(self):
            pass

    class _FakeHTTPClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def head(self, url: str):
            return _FakeResponse()

    monkeypatch.setattr(healthz_mod.httpx, "AsyncClient", lambda **kw: _FakeHTTPClient())

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/healthz/deep")

    assert resp.status_code == 503
    data = resp.json()
    assert data["ok"] is False
    assert data["checks"]["db"]["ok"] is False
    assert "error" in data["checks"]["db"]


# ---------------------------------------------------------------------------
# /healthz/deep — Clerk JWKS unreachable
# ---------------------------------------------------------------------------

def test_healthz_deep_jwks_failure(monkeypatch):
    """When the JWKS HEAD request fails, deep probe returns 503."""
    import httpx as httpx_real
    from autocontent.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")

    # Patch DB to succeed.
    class _FakePool:
        async def fetchval(self, query: str):
            return 1

    async def _fake_get_pool():
        return _FakePool()

    import backend.routes.healthz as healthz_mod
    monkeypatch.setattr(healthz_mod, "get_pool", _fake_get_pool)

    # Patch httpx AsyncClient to raise a network error.
    class _FailingHTTPClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def head(self, url: str):
            raise httpx_real.ConnectError("connection refused")

    import backend.routes.healthz as healthz_mod
    monkeypatch.setattr(healthz_mod.httpx, "AsyncClient", lambda **kw: _FailingHTTPClient())

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/healthz/deep")

    assert resp.status_code == 503
    data = resp.json()
    assert data["ok"] is False
    assert data["checks"]["clerk_jwks"]["ok"] is False
    assert "error" in data["checks"]["clerk_jwks"]


# ---------------------------------------------------------------------------
# /healthz/deep — optional API key missing
# ---------------------------------------------------------------------------

def test_healthz_deep_optional_key_missing_still_200(monkeypatch):
    """Missing optional API keys must not degrade the overall status."""
    from autocontent.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "https://clerk.test/.well-known/jwks.json")
    monkeypatch.setattr(settings, "openai_api_key", "")  # missing — should be "configured: false"
    monkeypatch.setattr(settings, "xai_api_key", "")
    monkeypatch.setattr(settings, "ayrshare_api_key", "")

    class _FakePool:
        async def fetchval(self, query: str):
            return 1

    async def _fake_get_pool():
        return _FakePool()

    import backend.routes.healthz as healthz_mod
    monkeypatch.setattr(healthz_mod, "get_pool", _fake_get_pool)

    class _FakeResponse:
        status_code = 200

        def raise_for_status(self):
            pass

    class _FakeHTTPClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def head(self, url: str):
            return _FakeResponse()

    import backend.routes.healthz as healthz_mod
    monkeypatch.setattr(healthz_mod.httpx, "AsyncClient", lambda **kw: _FakeHTTPClient())

    from backend.main import create_app
    client = TestClient(create_app(), raise_server_exceptions=False)
    resp = client.get("/healthz/deep")

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["checks"]["openai_api_key"] == {"configured": False}
