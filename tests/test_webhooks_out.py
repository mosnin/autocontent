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
    # This test exercises signing, not the SSRF guard; the .example host
    # doesn't resolve, so stub the guard to allow it.
    monkeypatch.setattr("marketer.services.ssrf.check_public_url", lambda url: (True, ""))
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
    # SSRF guard is covered in test_phase4_fixes; stub it here (.example host
    # doesn't resolve) so this test can exercise the secret-once behavior.
    monkeypatch.setattr("marketer.services.ssrf.check_public_url", lambda url: (True, ""))
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


def test_delete_foreign_or_unknown_endpoint_404s(monkeypatch):
    """A miss and a foreign id are the same 404 — never confirm the row
    exists for another tenant, and never DELETE without user_id."""
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    seen: dict = {}

    async def _delete(endpoint_id, *, user_id):
        seen["id"] = endpoint_id
        seen["user_id"] = user_id
        return False

    monkeypatch.setattr(repo, "delete", _delete)
    client = _client(monkeypatch)
    eid = uuid4()
    resp = client.delete(
        f"/api/v1/webhook-endpoints/{eid}",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
    assert seen == {"id": eid, "user_id": _USER}


def test_delete_owned_endpoint_is_204(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    seen: dict = {}

    async def _delete(endpoint_id, *, user_id):
        seen["id"] = endpoint_id
        seen["user_id"] = user_id
        return True

    monkeypatch.setattr(repo, "delete", _delete)
    client = _client(monkeypatch)
    eid = uuid4()
    resp = client.delete(
        f"/api/v1/webhook-endpoints/{eid}",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 204
    assert seen == {"id": eid, "user_id": _USER}


def _endpoint(eid=None, *, url="https://ok.example/x", enabled=True):
    from datetime import datetime, timezone

    from marketer.repos.webhooks_out import WebhookEndpoint

    return WebhookEndpoint(
        id=eid or uuid4(),
        user_id=_USER,
        url=url,
        events=[],
        enabled=enabled,
        description="",
        created_at=datetime.now(timezone.utc),
    )


def test_send_test_foreign_or_unknown_endpoint_404s(monkeypatch):
    """A test ping to someone else's endpoint must not open a socket."""
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    seen: dict = {}

    async def _get(endpoint_id, *, user_id):
        seen["id"] = endpoint_id
        seen["user_id"] = user_id
        return None

    async def _boom(*_a, **_k):
        raise AssertionError("must not deliver or look up a secret on a 404")

    monkeypatch.setattr(repo, "get", _get)
    monkeypatch.setattr(repo, "deliverable_for_event", _boom)
    monkeypatch.setattr(webhook_delivery, "deliver_one", _boom)
    client = _client(monkeypatch)
    eid = uuid4()
    resp = client.post(
        f"/api/v1/webhook-endpoints/{eid}/test",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 404
    assert seen == {"id": eid, "user_id": _USER}


def test_send_test_disabled_endpoint_409s_without_posting(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    ep = _endpoint(enabled=True)
    posted = {"n": 0}

    async def _get(endpoint_id, *, user_id):
        return ep

    async def _targets(user_id, event):
        return []

    async def _deliver(*_a, **_k):
        posted["n"] += 1
        return 200

    monkeypatch.setattr(repo, "get", _get)
    monkeypatch.setattr(repo, "deliverable_for_event", _targets)
    monkeypatch.setattr(webhook_delivery, "deliver_one", _deliver)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/webhook-endpoints/{ep.id}/test",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 409
    assert posted["n"] == 0


def test_send_test_posts_signed_ping_and_records_status(monkeypatch):
    _reset_limiter()
    import marketer.repos.webhooks_out as repo

    ep = _endpoint()
    delivered: dict = {}
    recorded: dict = {}

    async def _get(endpoint_id, *, user_id):
        assert user_id == _USER
        return ep

    async def _targets(user_id, event):
        assert user_id == _USER
        assert event == "test.ping"
        return [(ep.url, "whsec_test")]

    async def _deliver(url, secret, *, event, payload, timestamp):
        delivered.update(
            url=url, secret=secret, event=event, payload=payload, timestamp=timestamp
        )
        return 204

    async def _record(url, user_id, status_code):
        recorded.update(url=url, user_id=user_id, status_code=status_code)

    monkeypatch.setattr(repo, "get", _get)
    monkeypatch.setattr(repo, "deliverable_for_event", _targets)
    monkeypatch.setattr(webhook_delivery, "deliver_one", _deliver)
    monkeypatch.setattr(repo, "record_delivery", _record)
    client = _client(monkeypatch)
    resp = client.post(
        f"/api/v1/webhook-endpoints/{ep.id}/test",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"delivered": True, "status_code": 204}
    assert delivered["url"] == ep.url
    assert delivered["secret"] == "whsec_test"
    assert delivered["event"] == "test.ping"
    assert delivered["payload"]["endpoint_id"] == str(ep.id)
    assert recorded == {"url": ep.url, "user_id": _USER, "status_code": 204}


async def test_delete_sql_is_scoped_to_the_caller(monkeypatch):
    """A DELETE that drops `user_id` would let any PAT erase any hook."""
    import marketer.repos.webhooks_out as repo

    captured: dict = {}

    class _Pool:
        async def execute(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return "DELETE 0"

    async def _pool():
        return _Pool()

    monkeypatch.setattr(repo, "get_pool", _pool)
    eid = uuid4()
    assert await repo.delete(eid, user_id=_USER) is False
    sql = " ".join(captured["sql"].split())
    assert "delete from webhook_endpoints" in sql
    assert "id = $1 and user_id = $2" in sql
    assert captured["args"] == (eid, _USER)


async def test_deliverable_sql_requires_enabled_and_caller(monkeypatch):
    """Disabled or foreign endpoints must not receive a signed payload."""
    import marketer.repos.webhooks_out as repo

    captured: dict = {}

    class _Pool:
        async def fetch(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return []

    async def _pool():
        return _Pool()

    monkeypatch.setattr(repo, "get_pool", _pool)
    assert await repo.deliverable_for_event(_USER, "job.done") == []
    sql = " ".join(captured["sql"].split())
    assert "user_id = $1" in sql
    assert "enabled" in sql
    assert "cardinality(events) = 0 or $2 = any(events)" in sql
    assert captured["args"] == (_USER, "job.done")
