"""Outbound webhooks: signing, fail-open delivery, and management routes."""
from __future__ import annotations

import hashlib
import hmac
import json
from uuid import uuid4

from fastapi.testclient import TestClient

from marketer.services import webhook_delivery

_USER = "user_wh_1"


def test_sign_is_hmac_sha256_over_ts_dot_body():
    secret = "whsec_test"
    ts = 1234567890
    body = json.dumps({"event": "x", "data": {}}, separators=(",", ":"))
    expected = hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    assert webhook_delivery.sign(secret, ts, body) == expected


async def test_deliver_one_signs_and_posts(monkeypatch):
    captured = {}

    class _Resp:
        status_code = 200

    class _Client:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, *, content, headers):
            captured["url"] = url
            captured["content"] = content
            captured["headers"] = headers
            return _Resp()

    monkeypatch.setattr(webhook_delivery.httpx, "AsyncClient", _Client)
    code = await webhook_delivery.deliver_one(
        "https://hook.example/x", "whsec_abc",
        event="job.done", payload={"job_id": "j1"}, timestamp=111,
    )
    assert code == 200
    sig = captured["headers"]["x-marketer-signature"]
    assert sig.startswith("t=111,v1=")
    v1 = sig.split("v1=")[1]
    assert v1 == webhook_delivery.sign("whsec_abc", 111, captured["content"])
    assert captured["headers"]["x-marketer-event"] == "job.done"


async def test_emit_is_fail_open_when_deliver_raises(monkeypatch):
    """A raising deliver_one (any error) must not escape emit — the pipeline
    that calls emit must never see a webhook failure."""
    async def _targets(uid, event):
        return [("https://down.example/x", "whsec_z")]

    async def _boom(*a, **k):
        raise RuntimeError("network down")

    async def _record(*a, **k):
        return None

    monkeypatch.setattr(webhook_delivery.webhooks_out, "deliverable_for_event", _targets)
    monkeypatch.setattr(webhook_delivery, "deliver_one", _boom)
    monkeypatch.setattr(webhook_delivery.webhooks_out, "record_delivery", _record)

    # Must not raise; counts the endpoint as attempted.
    delivered = await webhook_delivery.emit(_USER, "job.done", {}, timestamp=1)
    assert delivered == 1


async def test_emit_returns_zero_when_lookup_fails(monkeypatch):
    async def _boom_lookup(uid, event):
        raise RuntimeError("db down")

    monkeypatch.setattr(webhook_delivery.webhooks_out, "deliverable_for_event", _boom_lookup)
    assert await webhook_delivery.emit(_USER, "job.done", {}, timestamp=1) == 0


# --------------------------------------------------------------------------- routes

def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="w@w.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def test_create_rejects_non_https(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/webhook-endpoints",
        json={"url": "http://insecure.example/x"}, headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_create_rejects_unknown_event(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/webhook-endpoints",
        json={"url": "https://ok.example/x", "events": ["job.exploded"]},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_create_returns_secret_once(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo
    from marketer.repos.webhooks_out import WebhookEndpoint
    from datetime import datetime, timezone

    async def _create(*, user_id, url, events, description=""):
        ep = WebhookEndpoint(
            id=uuid4(), user_id=user_id, url=url, events=events, enabled=True,
            description=description, created_at=datetime.now(timezone.utc),
        )
        ep.secret = "whsec_reveal"
        return ep

    monkeypatch.setattr(repo, "create", _create)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/webhook-endpoints",
        json={"url": "https://ok.example/x", "events": ["job.done"]},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 201
    assert resp.json()["secret"] == "whsec_reveal"


def test_patch_toggles_enabled(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo
    from marketer.repos.webhooks_out import WebhookEndpoint
    from datetime import datetime, timezone

    eid = uuid4()
    seen = {}

    async def _set_enabled(endpoint_id, *, user_id, enabled):
        seen["id"] = endpoint_id
        seen["enabled"] = enabled
        return WebhookEndpoint(
            id=endpoint_id, user_id=user_id, url="https://ok.example/x",
            events=[], enabled=enabled, description="",
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(repo, "set_enabled", _set_enabled)
    client = _client(monkeypatch)
    resp = client.patch(
        f"/api/v1/webhook-endpoints/{eid}",
        json={"enabled": False}, headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False
    assert seen == {"id": eid, "enabled": False}
    # The one-time secret is never re-exposed on update.
    assert resp.json()["secret"] is None


def test_patch_unknown_endpoint_404s(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    async def _set_enabled(endpoint_id, *, user_id, enabled):
        return None

    monkeypatch.setattr(repo, "set_enabled", _set_enabled)
    client = _client(monkeypatch)
    resp = client.patch(
        f"/api/v1/webhook-endpoints/{uuid4()}",
        json={"enabled": True}, headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
