"""GDPR export + erasure routes."""
from __future__ import annotations

from fastapi.testclient import TestClient
from tests.auth_helpers import ctx_for

_USER = "user_privacy_1"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "auth_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import require_user

    async def _fake():
        return ctx_for("owner", user_id=_USER, email="p@p.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_export_returns_bundle(monkeypatch):
    _reset_limiter()
    import marketer.repos.privacy as privacy

    async def _export(uid):
        assert uid == _USER
        return {"user": {"id": uid}, "niches": [], "jobs": [], "articles": []}

    monkeypatch.setattr(privacy, "export_user", _export)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/users/me/export", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["id"] == _USER
    assert body["exported_at"]  # stamped by the route
    assert "attachment" in resp.headers["content-disposition"]


def test_erasure_calls_repo_and_204(monkeypatch):
    _reset_limiter()
    import marketer.repos.privacy as privacy
    erased: list[str] = []

    async def _erase(uid):
        erased.append(uid)
        return True

    monkeypatch.setattr(privacy, "erase_user", _erase)
    client = _client(monkeypatch)
    resp = client.delete("/api/v1/users/me", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 204
    assert erased == [_USER]
