"""POST/GET/DELETE /api/v1/competitors, GET .../articles, POST .../watch/run,
GET/POST .../alerts — all repo/service calls monkeypatched, no real DB."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import asyncpg
from fastapi.testclient import TestClient

from marketer.repos.competitors import Competitor, CompetitorArticle, PerformanceAlert

_USER = "user_competitors"


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch) -> TestClient:
    from marketer.config import settings
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user

    async def _fake():
        return AuthCtx(user_id=_USER, email="c@c.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _competitor(**overrides) -> Competitor:
    base = dict(
        id=uuid4(), user_id=_USER, niche_id=None, domain="rival.com", label="Rival",
        created_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return Competitor(**base)


def _alert(**overrides) -> PerformanceAlert:
    base = dict(
        id=uuid4(), user_id=_USER, kind="cadence_slip", severity="warn",
        message="slipping", context={}, created_at=datetime.now(timezone.utc),
        acknowledged_at=None,
    )
    base.update(overrides)
    return PerformanceAlert(**base)


AUTH = {"Authorization": "Bearer mkt_x"}


# --------------------------------------------------------------------------- POST /competitors


def test_create_competitor_normalizes_domain(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    seen = {}

    async def _create(*, user_id, domain, label, niche_id):
        seen.update(user_id=user_id, domain=domain, label=label, niche_id=niche_id)
        return _competitor(domain=domain, label=label)

    monkeypatch.setattr(competitors_repo, "create", _create)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/competitors",
        json={"domain": "https://WWW.Rival.com/blog", "label": "Rival"},
        headers=AUTH,
    )
    assert resp.status_code == 201
    assert seen["domain"] == "rival.com"
    assert seen["user_id"] == _USER
    assert resp.json()["domain"] == "rival.com"


def test_create_competitor_rejects_empty_domain(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.post("/api/v1/competitors", json={"domain": "https://"}, headers=AUTH)
    assert resp.status_code == 422


def test_create_competitor_conflict_on_duplicate(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    async def _create(*, user_id, domain, label, niche_id):
        raise asyncpg.UniqueViolationError("duplicate key")

    monkeypatch.setattr(competitors_repo, "create", _create)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/competitors", json={"domain": "rival.com"}, headers=AUTH)
    assert resp.status_code == 409


# --------------------------------------------------------------------------- GET/DELETE /competitors


def test_list_competitors(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    async def _list(user_id):
        assert user_id == _USER
        return [_competitor(), _competitor(domain="other.com")]

    monkeypatch.setattr(competitors_repo, "list_for_user", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/competitors", headers=AUTH)
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_delete_competitor_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    async def _delete(competitor_id, *, user_id):
        assert user_id == _USER
        return True

    monkeypatch.setattr(competitors_repo, "delete", _delete)
    client = _client(monkeypatch)
    resp = client.delete(f"/api/v1/competitors/{uuid4()}", headers=AUTH)
    assert resp.status_code == 204


def test_delete_competitor_404(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    async def _delete(competitor_id, *, user_id):
        return False

    monkeypatch.setattr(competitors_repo, "delete", _delete)
    client = _client(monkeypatch)
    resp = client.delete(f"/api/v1/competitors/{uuid4()}", headers=AUTH)
    assert resp.status_code == 404


# --------------------------------------------------------------------------- GET /competitors/{id}/articles


def test_list_competitor_articles_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    comp = _competitor()

    async def _get(competitor_id, *, user_id):
        assert user_id == _USER
        return comp

    async def _articles(competitor_id, *, user_id):
        return [CompetitorArticle(
            id=uuid4(), competitor_id=comp.id, url="https://rival.com/x", title="X",
            published_hint="", first_seen=datetime.now(timezone.utc),
        )]

    monkeypatch.setattr(competitors_repo, "get", _get)
    monkeypatch.setattr(competitors_repo, "list_articles", _articles)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/competitors/{comp.id}/articles", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()[0]["url"] == "https://rival.com/x"


def test_list_competitor_articles_404_when_missing(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    async def _get(competitor_id, *, user_id):
        return None

    monkeypatch.setattr(competitors_repo, "get", _get)
    client = _client(monkeypatch)
    resp = client.get(f"/api/v1/competitors/{uuid4()}/articles", headers=AUTH)
    assert resp.status_code == 404


# --------------------------------------------------------------------------- POST /competitors/watch/run


def test_watch_run_calls_service(monkeypatch):
    _reset_limiter()
    import marketer.services.competitor_watch as competitor_watch

    async def _run():
        return {"competitors_scanned": 3, "found": 1, "alerts_raised": 1}

    monkeypatch.setattr(competitor_watch, "run", _run)
    client = _client(monkeypatch)
    resp = client.post("/api/v1/competitors/watch/run", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == {"competitors_scanned": 3, "found": 1, "alerts_raised": 1}


# --------------------------------------------------------------------------- GET /competitors/alerts


def test_list_alerts_unacknowledged_filter(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    seen = {}

    async def _list(user_id, *, acknowledged=None, limit=200):
        seen["acknowledged"] = acknowledged
        return [_alert()]

    monkeypatch.setattr(competitors_repo, "list_alerts_for_user", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/competitors/alerts?acknowledged=false", headers=AUTH)
    assert resp.status_code == 200
    assert seen["acknowledged"] is False
    assert len(resp.json()) == 1


def test_list_alerts_no_filter(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    seen = {}

    async def _list(user_id, *, acknowledged=None, limit=200):
        seen["acknowledged"] = acknowledged
        return []

    monkeypatch.setattr(competitors_repo, "list_alerts_for_user", _list)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/competitors/alerts", headers=AUTH)
    assert resp.status_code == 200
    assert seen["acknowledged"] is None


# --------------------------------------------------------------------------- POST /competitors/alerts/{id}/ack


def test_ack_alert_ok(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    acked = _alert(acknowledged_at=datetime.now(timezone.utc))

    async def _ack(alert_id, *, user_id):
        assert user_id == _USER
        return acked

    monkeypatch.setattr(competitors_repo, "acknowledge", _ack)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/competitors/alerts/{uuid4()}/ack", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["acknowledged_at"] is not None


def test_ack_alert_404_when_missing_or_already_acked(monkeypatch):
    _reset_limiter()
    import marketer.repos.competitors as competitors_repo

    async def _ack(alert_id, *, user_id):
        return None

    monkeypatch.setattr(competitors_repo, "acknowledge", _ack)
    client = _client(monkeypatch)
    resp = client.post(f"/api/v1/competitors/alerts/{uuid4()}/ack", headers=AUTH)
    assert resp.status_code == 404
