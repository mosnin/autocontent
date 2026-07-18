"""Unit tests for marketer.services.gsc: signed-state CSRF, OAuth code
exchange/refresh, and the Search Analytics/sites wrappers. All Google calls
go through a MockTransport — no network."""
from __future__ import annotations

import json
import time
from urllib.parse import parse_qsl

import httpx
import pytest

from marketer.services import gsc


@pytest.fixture(autouse=True)
def _oauth_client(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "google_oauth_client_id", "client-123")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "secret-xyz")


@pytest.fixture
def patch_async_client(monkeypatch):
    """Force every httpx.AsyncClient(...) in gsc.py to use a caller-supplied
    MockTransport (same pattern as test_ayrshare_profiles.py)."""
    holder: dict = {}
    original = httpx.AsyncClient

    def _factory(*args, **kwargs):
        if "transport" not in kwargs and holder.get("transport") is not None:
            kwargs["transport"] = holder["transport"]
        return original(*args, **kwargs)

    monkeypatch.setattr(gsc.httpx, "AsyncClient", _factory)

    def install(transport: httpx.MockTransport) -> None:
        holder["transport"] = transport

    return install


def _json_transport(*, captured: dict, response: dict, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        if request.content:
            content_type = request.headers.get("content-type", "")
            if "application/x-www-form-urlencoded" in content_type:
                captured["body"] = dict(parse_qsl(request.content.decode()))
            else:
                try:
                    captured["body"] = json.loads(request.content)
                except json.JSONDecodeError:
                    captured["body"] = request.content
        return httpx.Response(status, json=response)

    return httpx.MockTransport(handler)


# --------------------------------------------------------------------------- is_enabled / GscDisabled

def test_disabled_without_client_credentials(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "google_oauth_client_id", "")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "")
    assert gsc.is_enabled() is False
    with pytest.raises(gsc.GscDisabled):
        gsc.authorize_url(redirect_uri="https://x/cb", state="s")
    with pytest.raises(gsc.GscDisabled):
        gsc.sign_state(user_id="u1")


async def test_disabled_exchange_and_refresh_raise(monkeypatch):
    from marketer.config import settings

    monkeypatch.setattr(settings, "google_oauth_client_id", "")
    with pytest.raises(gsc.GscDisabled):
        await gsc.exchange_code(code="c", redirect_uri="https://x/cb")
    with pytest.raises(gsc.GscDisabled):
        await gsc.refresh_access_token(refresh_token="rt")


# --------------------------------------------------------------------------- signed state

def test_sign_and_verify_state_roundtrip():
    state = gsc.sign_state(user_id="user_1", return_to="/settings")
    payload = gsc.verify_state(state)
    assert payload.user_id == "user_1"
    assert payload.return_to == "/settings"


def test_verify_state_rejects_tampered_signature():
    state = gsc.sign_state(user_id="user_1")
    b64, _sig = state.split(".", 1)
    tampered = f"{b64}.{'0' * 64}"
    with pytest.raises(gsc.GscApiError, match="invalid state signature"):
        gsc.verify_state(tampered)


def test_verify_state_rejects_tampered_payload():
    state = gsc.sign_state(user_id="user_1")
    b64, sig = state.split(".", 1)
    # Flip the payload but keep the (now-mismatched) original signature.
    other_state = gsc.sign_state(user_id="attacker")
    other_b64, _ = other_state.split(".", 1)
    forged = f"{other_b64}.{sig}"
    with pytest.raises(gsc.GscApiError, match="invalid state signature"):
        gsc.verify_state(forged)


def test_verify_state_rejects_malformed_input():
    with pytest.raises(gsc.GscApiError, match="malformed state"):
        gsc.verify_state("not-a-valid-state-at-all")


def test_verify_state_rejects_expired(monkeypatch):
    state = gsc.sign_state(user_id="user_1")
    # Jump time past the state's TTL.
    real_time = time.time()
    monkeypatch.setattr(time, "time", lambda: real_time + gsc._STATE_TTL_SEC + 60)
    with pytest.raises(gsc.GscApiError, match="expired"):
        gsc.verify_state(state)


def test_verify_state_requires_configured_secret(monkeypatch):
    from marketer.config import settings

    state = gsc.sign_state(user_id="user_1")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "")
    with pytest.raises(gsc.GscDisabled):
        gsc.verify_state(state)


# --------------------------------------------------------------------------- authorize_url

def test_authorize_url_contains_scope_and_state():
    url = gsc.authorize_url(redirect_uri="https://app.example/api/v1/gsc/callback", state="abc.def")
    assert url.startswith(gsc.AUTHORIZE_URL)
    assert "client_id=client-123" in url
    assert "access_type=offline" in url
    assert "prompt=consent" in url
    assert "state=abc.def" in url
    assert "webmasters.readonly" in url


# --------------------------------------------------------------------------- token exchange / refresh

async def test_exchange_code_returns_tokens(patch_async_client):
    captured: dict = {}
    patch_async_client(_json_transport(
        captured=captured,
        response={"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600},
    ))

    tokens = await gsc.exchange_code(code="auth-code", redirect_uri="https://x/cb")

    assert tokens.access_token == "at-1"
    assert tokens.refresh_token == "rt-1"
    assert tokens.expires_in == 3600
    assert captured["body"]["grant_type"] == "authorization_code"
    assert captured["body"]["code"] == "auth-code"
    assert captured["body"]["client_secret"] == "secret-xyz"
    assert captured["url"] == gsc.TOKEN_URL


async def test_exchange_code_missing_refresh_token_raises(patch_async_client):
    patch_async_client(_json_transport(
        captured={}, response={"access_token": "at-1"},  # no refresh_token
    ))
    with pytest.raises(gsc.GscApiError, match="missing"):
        await gsc.exchange_code(code="auth-code", redirect_uri="https://x/cb")


async def test_exchange_code_4xx_raises(patch_async_client):
    patch_async_client(_json_transport(
        captured={}, response={"error": "invalid_grant"}, status=400,
    ))
    with pytest.raises(gsc.GscApiError, match="400"):
        await gsc.exchange_code(code="bad-code", redirect_uri="https://x/cb")


async def test_refresh_access_token_returns_new_access_token(patch_async_client):
    captured: dict = {}
    patch_async_client(_json_transport(
        captured=captured, response={"access_token": "at-2", "expires_in": 1800},
    ))

    tokens = await gsc.refresh_access_token(refresh_token="rt-1")

    assert tokens.access_token == "at-2"
    assert tokens.refresh_token == ""  # Google typically omits it on refresh
    assert captured["body"]["grant_type"] == "refresh_token"
    assert captured["body"]["refresh_token"] == "rt-1"


async def test_refresh_access_token_missing_access_token_raises(patch_async_client):
    patch_async_client(_json_transport(captured={}, response={}))
    with pytest.raises(gsc.GscApiError, match="missing"):
        await gsc.refresh_access_token(refresh_token="rt-1")


async def test_refresh_access_token_4xx_raises(patch_async_client):
    patch_async_client(_json_transport(
        captured={}, response={"error": "invalid_grant"}, status=401,
    ))
    with pytest.raises(gsc.GscApiError, match="401"):
        await gsc.refresh_access_token(refresh_token="revoked")


# --------------------------------------------------------------------------- search analytics / sites

async def test_query_search_analytics_returns_rows(patch_async_client):
    captured: dict = {}
    patch_async_client(_json_transport(
        captured=captured,
        response={"rows": [
            {"keys": ["2026-07-01", "best grinders", "/blog/grinders"], "clicks": 3, "impressions": 40, "ctr": 0.075, "position": 8.2},
        ]},
    ))

    rows = await gsc.query_search_analytics(
        access_token="at-1", site_url="https://example.com/",
        start_date="2026-07-01", end_date="2026-07-03",
        dimensions=["date", "query", "page"],
    )

    assert len(rows) == 1
    assert rows[0]["keys"] == ["2026-07-01", "best grinders", "/blog/grinders"]
    assert captured["headers"]["authorization"] == "Bearer at-1"
    assert "example.com" in captured["url"]  # site URL is percent-encoded into the path
    assert captured["body"]["dimensions"] == ["date", "query", "page"]


async def test_query_search_analytics_empty_rows(patch_async_client):
    patch_async_client(_json_transport(captured={}, response={}))
    rows = await gsc.query_search_analytics(
        access_token="at-1", site_url="https://example.com/",
        start_date="2026-07-01", end_date="2026-07-03", dimensions=["query"],
    )
    assert rows == []


async def test_query_search_analytics_4xx_raises(patch_async_client):
    patch_async_client(_json_transport(captured={}, response={"error": "bad"}, status=403))
    with pytest.raises(gsc.GscApiError, match="403"):
        await gsc.query_search_analytics(
            access_token="at-1", site_url="https://example.com/",
            start_date="2026-07-01", end_date="2026-07-03", dimensions=["query"],
        )


async def test_list_sites_returns_site_entries(patch_async_client):
    patch_async_client(_json_transport(
        captured={}, response={"siteEntry": [{"siteUrl": "https://example.com/", "permissionLevel": "siteOwner"}]},
    ))
    sites = await gsc.list_sites(access_token="at-1")
    assert sites == [{"siteUrl": "https://example.com/", "permissionLevel": "siteOwner"}]
