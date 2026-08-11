"""Content calendar route."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from marketer.repos.calendar import CalendarItem

_USER = "user_cal_1"


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


def test_calendar_returns_items(monkeypatch):
    _reset_limiter()
    import marketer.repos.calendar as cal

    async def _items(uid, *, start, end):
        assert uid == _USER
        assert end > start
        return [
            CalendarItem(kind="video", id="j1", niche_id="n1", title="hook",
                         status="done", platform="tiktok", at=datetime.now(timezone.utc)),
            CalendarItem(kind="article", id="a1", niche_id="n1", title="topic",
                         status="done", at=datetime.now(timezone.utc)),
        ]

    monkeypatch.setattr(cal, "items_for_user", _items)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/calendar?days=30", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    kinds = {i["kind"] for i in resp.json()}
    assert kinds == {"video", "article"}


def test_calendar_rejects_inverted_range(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/calendar?start=2026-02-01T00:00:00Z&end=2026-01-01T00:00:00Z",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_calendar_rejects_huge_window(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/calendar?start=2026-01-01T00:00:00Z&end=2027-01-01T00:00:00Z",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422
