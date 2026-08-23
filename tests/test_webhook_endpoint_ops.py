"""Outbound webhook endpoint delete + test-ping — tenant-scoped ops.

Kept separate from tests/test_webhooks_out.py so this run does not collide
with the open coverage PR that already extends that file.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.repos.webhooks_out import WebhookEndpoint

_USER = "user_wh_ops"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id=_USER, email="w@w.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_delete_unknown_endpoint_404s(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    seen: list[tuple] = []

    async def _delete(endpoint_id, *, user_id):
        seen.append((endpoint_id, user_id))
        return False

    monkeypatch.setattr(repo, "delete", _delete)
    eid = uuid4()
    client = _client(monkeypatch)
    resp = client.delete(
        f"/api/v1/webhook-endpoints/{eid}",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
    assert seen == [(eid, _USER)]


def test_delete_owned_endpoint_204s(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    async def _delete(endpoint_id, *, user_id):
        assert user_id == _USER
        return True

    monkeypatch.setattr(repo, "delete", _delete)
    client = _client(monkeypatch)
    resp = client.delete(
        f"/api/v1/webhook-endpoints/{uuid4()}",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 204


def test_test_ping_409_when_disabled(monkeypatch):
    """A disabled (or event-filtered) endpoint must not send a signed ping."""
    _reset_limiter()
    import marketer.repos.webhooks_out as repo
    from marketer.services import webhook_delivery

    eid = uuid4()

    async def _get(endpoint_id, *, user_id):
        assert user_id == _USER
        return WebhookEndpoint(
            id=endpoint_id, user_id=user_id, url="https://ok.example/x",
            events=["job.done"], enabled=False, description="",
            created_at=datetime.now(timezone.utc),
        )

    async def _deliverable(user_id, event):
        return []  # disabled / not subscribed to test.ping

    async def explode(*a, **k):
        raise AssertionError("must not POST a signed payload for a disabled endpoint")

    monkeypatch.setattr(repo, "get", _get)
    monkeypatch.setattr(repo, "deliverable_for_event", _deliverable)
    monkeypatch.setattr(webhook_delivery, "deliver_one", explode)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/webhook-endpoints/{eid}/test",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409


def test_test_ping_404_for_other_tenant(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo
    from marketer.services import webhook_delivery

    async def _get(endpoint_id, *, user_id):
        return None

    async def explode(*a, **k):
        raise AssertionError("must not deliver to another tenant's endpoint")

    monkeypatch.setattr(repo, "get", _get)
    monkeypatch.setattr(webhook_delivery, "deliver_one", explode)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/webhook-endpoints/{uuid4()}/test",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
