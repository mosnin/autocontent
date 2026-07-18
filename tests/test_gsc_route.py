"""Route-level tests for /api/v1/gsc. Repos + the gsc service are
monkeypatched; auth is bypassed via dependency_overrides (same pattern as
test_ads_route.py). No network, no DB."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient


def _reset_limiter():
    from backend.rate_limit import limiter
    limiter._storage.reset()


def _client(monkeypatch, *, oauth_configured: bool = True) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    monkeypatch.setattr(settings, "google_oauth_client_id", "client-123" if oauth_configured else "")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "secret-xyz" if oauth_configured else "")

    from backend.auth import AuthCtx, require_user
    from backend.main import create_app

    async def _fake():
        return AuthCtx(user_id="user_gsc", email="gsc@t.com")

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


def _mk_conn(**kw):
    from marketer.repos.gsc import GscConnection

    base = dict(
        id="00000000-0000-0000-0000-000000000001",
        user_id="user_gsc",
        site_url="https://example.com/",
        refresh_token="rt-1",
        access_token="at-1",
        token_expires_at=datetime.now(timezone.utc),
        connected_at=datetime.now(timezone.utc),
    )
    base.update(kw)
    return GscConnection(**base)


# --------------------------------------------------------------------------- connect

def test_connect_returns_authorize_url_and_state(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/connect", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["authorize_url"].startswith("https://accounts.google.com/o/oauth2/v2/auth")
    assert "state" in body and "." in body["state"]


def test_connect_409_when_disabled(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch, oauth_configured=False)
    resp = client.get("/api/v1/gsc/connect", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 409


def test_connect_rejects_absolute_return_to(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/gsc/connect?return_to=https://evil.example/",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


# --------------------------------------------------------------------------- callback

def test_callback_missing_code_or_state(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/callback")
    assert resp.status_code == 400


def test_callback_google_error_param(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/callback?error=access_denied")
    assert resp.status_code == 400


def test_callback_rejects_tampered_state(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/callback?code=abc&state=not.valid")
    assert resp.status_code == 400


def test_callback_happy_path_stores_connection(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    import marketer.repos.gsc as gsc_repo
    from marketer.services import gsc as gsc_service

    state = gsc_service.sign_state(user_id="user_gsc")

    async def _exchange(*, code, redirect_uri):
        assert code == "auth-code"
        return gsc_service.TokenSet(access_token="at-1", refresh_token="rt-1", expires_in=3600)

    stored: dict = {}

    async def _upsert(*, user_id, refresh_token, access_token, token_expires_at):
        stored.update(user_id=user_id, refresh_token=refresh_token, access_token=access_token)
        return _mk_conn(user_id=user_id)

    monkeypatch.setattr(gsc_service, "exchange_code", _exchange)
    monkeypatch.setattr(gsc_repo, "upsert_connection", _upsert)

    resp = client.get(f"/api/v1/gsc/callback?code=auth-code&state={state}")
    assert resp.status_code == 200
    assert resp.json() == {"connected": True}
    assert stored["user_id"] == "user_gsc"
    assert stored["refresh_token"] == "rt-1"


def test_callback_redirects_when_return_to_set(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    import marketer.repos.gsc as gsc_repo
    from marketer.services import gsc as gsc_service

    state = gsc_service.sign_state(user_id="user_gsc", return_to="/app/settings")

    async def _exchange(*, code, redirect_uri):
        return gsc_service.TokenSet(access_token="at-1", refresh_token="rt-1", expires_in=3600)

    async def _upsert(**kwargs):
        return _mk_conn()

    monkeypatch.setattr(gsc_service, "exchange_code", _exchange)
    monkeypatch.setattr(gsc_repo, "upsert_connection", _upsert)

    resp = client.get(
        f"/api/v1/gsc/callback?code=auth-code&state={state}", follow_redirects=False
    )
    assert resp.status_code in (302, 307)
    assert resp.headers["location"].startswith("/app/settings")


# --------------------------------------------------------------------------- status / site / connection

def test_status_not_connected(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _get(user_id):
        return None

    monkeypatch.setattr(gsc_repo, "get_connection", _get)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/status", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json() == {"connected": False, "site_url": ""}


def test_status_connected(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _get(user_id):
        return _mk_conn(site_url="https://example.com/")

    monkeypatch.setattr(gsc_repo, "get_connection", _get)
    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/status", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json() == {"connected": True, "site_url": "https://example.com/"}


def test_set_site_rejects_bad_format(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/gsc/site", json={"site_url": "not-a-real-site"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_set_site_requires_connection(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _get(user_id):
        return None

    monkeypatch.setattr(gsc_repo, "get_connection", _get)
    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/gsc/site", json={"site_url": "https://example.com/"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 400


def test_set_site_forbidden_when_not_authorized(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo
    import marketer.services.gsc_sync as gsc_sync
    from marketer.services import gsc as gsc_service

    async def _get(user_id):
        return _mk_conn()

    async def _ensure(conn):
        return "at-live"

    async def _list_sites(*, access_token):
        return [{"siteUrl": "https://other-site.com/", "permissionLevel": "siteOwner"}]

    monkeypatch.setattr(gsc_repo, "get_connection", _get)
    monkeypatch.setattr(gsc_sync, "ensure_fresh_access_token", _ensure)
    monkeypatch.setattr(gsc_service, "list_sites", _list_sites)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/gsc/site", json={"site_url": "https://example.com/"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 403


def test_set_site_success(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo
    import marketer.services.gsc_sync as gsc_sync
    from marketer.services import gsc as gsc_service

    async def _get(user_id):
        return _mk_conn()

    async def _ensure(conn):
        return "at-live"

    async def _list_sites(*, access_token):
        return [{"siteUrl": "https://example.com/", "permissionLevel": "siteOwner"}]

    set_calls = []

    async def _set_site(user_id, *, site_url):
        set_calls.append((user_id, site_url))
        return _mk_conn(site_url=site_url)

    monkeypatch.setattr(gsc_repo, "get_connection", _get)
    monkeypatch.setattr(gsc_sync, "ensure_fresh_access_token", _ensure)
    monkeypatch.setattr(gsc_service, "list_sites", _list_sites)
    monkeypatch.setattr(gsc_repo, "set_site", _set_site)

    client = _client(monkeypatch)
    resp = client.post(
        "/api/v1/gsc/site", json={"site_url": "https://example.com/"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"connected": True, "site_url": "https://example.com/"}
    assert set_calls == [("user_gsc", "https://example.com/")]


def test_delete_connection(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _delete(user_id):
        return True

    monkeypatch.setattr(gsc_repo, "delete_connection", _delete)
    client = _client(monkeypatch)
    resp = client.delete("/api/v1/gsc/connection", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json() == {"connected": False, "site_url": ""}


# --------------------------------------------------------------------------- rankings / queries / gaps

def test_rankings_computes_position_delta(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _get_conn(user_id):
        return _mk_conn(site_url="https://example.com/")

    async def _top_queries(user_id, *, start, end, limit):
        return [
            {"query": "espresso machines", "clicks": 20, "impressions": 300, "ctr": 0.0667, "position": 4.0},
            {"query": "pour over kettle", "clicks": 5, "impressions": 100, "ctr": 0.05, "position": 15.0},
        ]

    async def _positions(user_id, queries, *, start, end):
        return {"espresso machines": 9.0}  # improved from 9.0 -> 4.0; no prior data for the other

    monkeypatch.setattr(gsc_repo, "get_connection", _get_conn)
    monkeypatch.setattr(gsc_repo, "top_queries", _top_queries)
    monkeypatch.setattr(gsc_repo, "positions_for_queries", _positions)

    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/gsc/rankings?days=28", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["site_url"] == "https://example.com/"
    items = {i["query"]: i for i in body["items"]}
    assert items["espresso machines"]["prior_position"] == 9.0
    assert items["espresso machines"]["position_delta"] == 5.0  # improved
    assert items["pour over kettle"]["prior_position"] is None
    assert items["pour over kettle"]["position_delta"] is None


def test_queries_for_page(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _queries_for_page(user_id, *, page, start, end, limit=100):
        assert page == "/blog/espresso"
        return [{"query": "espresso machines", "clicks": 3, "impressions": 40, "ctr": 0.075, "position": 6.0}]

    monkeypatch.setattr(gsc_repo, "queries_for_page", _queries_for_page)
    client = _client(monkeypatch)
    resp = client.get(
        "/api/v1/gsc/queries?page=/blog/espresso", headers={"Authorization": "Bearer mkt_x"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["page"] == "/blog/espresso"
    assert body["items"][0]["query"] == "espresso machines"


def test_queries_requires_page_param(monkeypatch):
    _reset_limiter()
    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/queries", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 422


def test_gaps_filters_matched_queries(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _gap_candidates(user_id, *, start, end, min_impressions, min_position):
        return [
            {"query": "espresso machines", "page": "/x", "clicks": 0, "impressions": 80, "position": 25.0},
            {"query": "best pour over kettle 2026", "page": "/y", "clicks": 1, "impressions": 60, "position": 30.0},
        ]

    async def _article_terms(user_id):
        # An article with focus_keyword "espresso machines" already covers
        # that query; nothing covers the kettle query.
        return [("Espresso Machines Buying Guide", "espresso machines")]

    monkeypatch.setattr(gsc_repo, "gap_candidates", _gap_candidates)
    monkeypatch.setattr(gsc_repo, "article_terms", _article_terms)

    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/gaps", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["query"] == "best pour over kettle 2026"


def test_gaps_title_substring_match_excludes(monkeypatch):
    _reset_limiter()
    import marketer.repos.gsc as gsc_repo

    async def _gap_candidates(user_id, *, start, end, min_impressions, min_position):
        return [{"query": "espresso", "page": "/x", "clicks": 0, "impressions": 80, "position": 25.0}]

    async def _article_terms(user_id):
        return [("The Best Espresso Machines of 2026", "")]

    monkeypatch.setattr(gsc_repo, "gap_candidates", _gap_candidates)
    monkeypatch.setattr(gsc_repo, "article_terms", _article_terms)

    client = _client(monkeypatch)
    resp = client.get("/api/v1/gsc/gaps", headers={"Authorization": "Bearer mkt_x"})
    assert resp.status_code == 200
    assert resp.json()["items"] == []
