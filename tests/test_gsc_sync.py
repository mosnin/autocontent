"""Unit tests for marketer.services.gsc_sync: cheap no-op when unconfigured,
per-connection token refresh, and upsert fan-out with per-user failure
isolation. Repo + gsc service calls are monkeypatched — no network, no DB."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from marketer.repos.gsc import GscConnection
from marketer.services import gsc_sync


def _conn(**kw) -> GscConnection:
    base = dict(
        id="00000000-0000-0000-0000-000000000001",
        user_id="user_1",
        site_url="https://example.com/",
        refresh_token="rt-1",
        access_token="",
        token_expires_at=None,
        connected_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return GscConnection(**base)


async def test_run_is_noop_when_unconfigured(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "google_oauth_client_id", "")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "")

    import marketer.repos.gsc as gsc_repo

    called = []

    async def _list_all():
        called.append(1)
        return []

    monkeypatch.setattr(gsc_repo, "list_all_connections", _list_all)

    result = await gsc_sync.run()

    assert result == {"skipped": "gsc not configured"}
    assert called == []  # never even touched the DB


async def test_run_skips_connections_without_site_url(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "google_oauth_client_id", "id")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "secret")

    import marketer.repos.gsc as gsc_repo

    async def _list_all():
        return [_conn(site_url="")]

    monkeypatch.setattr(gsc_repo, "list_all_connections", _list_all)

    result = await gsc_sync.run()

    assert result == {"connections": 1, "synced": 0, "failed": 0, "rows": 0}


async def test_run_syncs_and_upserts(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "google_oauth_client_id", "id")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "secret")

    import marketer.repos.gsc as gsc_repo
    from marketer.services import gsc as gsc_service

    conn = _conn(access_token="at-fresh", token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1))

    async def _list_all():
        return [conn]

    upserted: dict = {}

    async def _upsert_daily(user_id, rows):
        upserted["user_id"] = user_id
        upserted["rows"] = rows
        return len(rows)

    async def _query_search_analytics(**kwargs):
        assert kwargs["access_token"] == "at-fresh"
        assert kwargs["site_url"] == "https://example.com/"
        assert kwargs["dimensions"] == ["date", "query", "page"]
        return [
            {"keys": ["2026-07-16", "espresso machines", "/blog/espresso"], "clicks": 5, "impressions": 90, "ctr": 0.055, "position": 6.4},
            {"keys": ["bad-row-too-few-keys"], "clicks": 0, "impressions": 0, "ctr": 0, "position": 0},
        ]

    monkeypatch.setattr(gsc_repo, "list_all_connections", _list_all)
    monkeypatch.setattr(gsc_repo, "upsert_daily", _upsert_daily)
    monkeypatch.setattr(gsc_service, "query_search_analytics", _query_search_analytics)

    result = await gsc_sync.run()

    assert result == {"connections": 1, "synced": 1, "failed": 0, "rows": 1}
    assert upserted["user_id"] == "user_1"
    assert len(upserted["rows"]) == 1  # malformed row dropped
    row = upserted["rows"][0]
    assert row["query"] == "espresso machines"
    assert row["page"] == "/blog/espresso"
    assert row["clicks"] == 5


async def test_run_isolates_per_user_failures(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "google_oauth_client_id", "id")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "secret")

    import marketer.repos.gsc as gsc_repo
    from marketer.services import gsc as gsc_service

    good = _conn(user_id="user_good", access_token="at", token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
    bad = _conn(user_id="user_bad", access_token="at", token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1))

    async def _list_all():
        return [bad, good]

    calls = []

    async def _query_search_analytics(**kwargs):
        calls.append(kwargs["site_url"])
        if kwargs["access_token"] == "at" and calls[-1] == "https://example.com/":
            pass
        return []

    async def _upsert_daily(user_id, rows):
        if user_id == "user_bad":
            raise RuntimeError("google says no")
        return 0

    monkeypatch.setattr(gsc_repo, "list_all_connections", _list_all)
    monkeypatch.setattr(gsc_service, "query_search_analytics", _query_search_analytics)
    monkeypatch.setattr(gsc_repo, "upsert_daily", _upsert_daily)

    result = await gsc_sync.run()

    assert result["connections"] == 2
    assert result["synced"] == 1
    assert result["failed"] == 1
    # Both users were attempted even though the first one raised.
    assert len(calls) == 2


async def test_ensure_fresh_access_token_reuses_unexpired(monkeypatch):
    from marketer.services import gsc as gsc_service

    conn = _conn(access_token="at-good", token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1))

    async def _refresh(**kwargs):
        raise AssertionError("should not refresh a still-valid token")

    monkeypatch.setattr(gsc_service, "refresh_access_token", _refresh)

    token = await gsc_sync.ensure_fresh_access_token(conn)
    assert token == "at-good"


async def test_ensure_fresh_access_token_refreshes_when_stale(monkeypatch):
    import marketer.repos.gsc as gsc_repo
    from marketer.services import gsc as gsc_service

    conn = _conn(access_token="at-old", token_expires_at=datetime.now(timezone.utc) - timedelta(minutes=5))

    async def _refresh(*, refresh_token):
        assert refresh_token == "rt-1"
        return gsc_service.TokenSet(access_token="at-new", refresh_token="", expires_in=3600)

    stored: dict = {}

    async def _set_tokens(user_id, *, access_token, token_expires_at, refresh_token=""):
        stored["user_id"] = user_id
        stored["access_token"] = access_token
        stored["refresh_token"] = refresh_token

    monkeypatch.setattr(gsc_service, "refresh_access_token", _refresh)
    monkeypatch.setattr(gsc_repo, "set_tokens", _set_tokens)

    token = await gsc_sync.ensure_fresh_access_token(conn)

    assert token == "at-new"
    assert stored["user_id"] == "user_1"
    assert stored["access_token"] == "at-new"


async def test_ensure_fresh_access_token_refreshes_when_missing_expiry(monkeypatch):
    import marketer.repos.gsc as gsc_repo
    from marketer.services import gsc as gsc_service

    conn = _conn(access_token="", token_expires_at=None)

    async def _refresh(*, refresh_token):
        return gsc_service.TokenSet(access_token="at-new", refresh_token="rt-new", expires_in=3600)

    async def _set_tokens(user_id, *, access_token, token_expires_at, refresh_token=""):
        pass

    monkeypatch.setattr(gsc_service, "refresh_access_token", _refresh)
    monkeypatch.setattr(gsc_repo, "set_tokens", _set_tokens)

    token = await gsc_sync.ensure_fresh_access_token(conn)
    assert token == "at-new"
