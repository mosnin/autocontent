"""Publish target CRUD (POST/GET /press/targets, DELETE /press/targets/{id}).
The secret must never be echoed back — POST creates it write-only."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.repos.publish_targets import PublishTarget

_USER = "user_press_targets"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _target(**overrides) -> PublishTarget:
    base = dict(
        id=uuid4(), user_id=_USER, kind="wordpress", name="Main blog",
        base_url="https://blog.example.com", username="editor", disabled=False,
        created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return PublishTarget(**base)


def test_create_target_never_echoes_secret(monkeypatch):
    _reset_limiter()
    import marketer.repos.publish_targets as targets_repo

    seen: dict = {}

    async def _create(*, user_id, kind, name, base_url, username, secret):
        seen["secret"] = secret
        return _target(kind=kind, name=name, base_url=base_url, username=username)

    monkeypatch.setattr(targets_repo, "create", _create)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/press/targets",
        json={
            "kind": "wordpress", "name": "Main blog",
            "base_url": "https://blog.example.com",
            "username": "editor", "secret": "app-password-xyz",
        },
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 201
    assert seen["secret"] == "app-password-xyz"
    body = resp.json()
    assert "secret" not in body
    assert body["name"] == "Main blog"


def test_create_target_rejects_bad_kind(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/press/targets",
        json={
            "kind": "ftp", "name": "x", "base_url": "https://x.com", "secret": "s",
        },
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_create_target_requires_secret(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/press/targets",
        json={"kind": "webhook", "name": "x", "base_url": "https://x.com/hook"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_list_targets_never_echoes_secret(monkeypatch):
    _reset_limiter()
    import marketer.repos.publish_targets as targets_repo

    async def _list(user_id):
        return [_target(), _target(kind="webhook", name="Slack relay", username="")]

    monkeypatch.setattr(targets_repo, "list_for_user", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/press/targets", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert all("secret" not in t for t in body)


def test_delete_target_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.publish_targets as targets_repo

    async def _delete(target_id, *, user_id):
        assert user_id == _USER
        return True

    monkeypatch.setattr(targets_repo, "delete", _delete)
    client = _client(monkeypatch)
    resp = client.delete(
        f"/api/v1/press/targets/{uuid4()}", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 204


def test_delete_target_404_when_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.publish_targets as targets_repo

    async def _delete(target_id, *, user_id):
        return False

    monkeypatch.setattr(targets_repo, "delete", _delete)
    client = _client(monkeypatch)
    resp = client.delete(
        f"/api/v1/press/targets/{uuid4()}", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 404
