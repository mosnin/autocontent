"""Tests for the Ayrshare analytics client.

All HTTP is intercepted via httpx.MockTransport — no real network calls.
"""
from __future__ import annotations

import pytest
import httpx

from marketer.services import ayrshare_analytics as analytics_module
from marketer.services.ayrshare_analytics import (
    AyrshareAnalyticsError,
    fetch_post_analytics,
)

PROVIDER_POST_ID = "ayr-post-abc123"


@pytest.fixture(autouse=True)
def _set_api_key(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "ayrshare_api_key", "ayr-test-key")


@pytest.fixture
def patch_async_client(monkeypatch):
    """Inject a MockTransport into every httpx.AsyncClient created by the module."""
    holder: dict = {}
    original = httpx.AsyncClient

    def _factory(*args, **kwargs):
        if "transport" not in kwargs and holder.get("transport") is not None:
            kwargs["transport"] = holder["transport"]
        return original(*args, **kwargs)

    monkeypatch.setattr(analytics_module.httpx, "AsyncClient", _factory)

    def install(transport: httpx.MockTransport) -> None:
        holder["transport"] = transport

    return install


# ---------------------------------------------------------------------------
# Happy-path: parses the full Ayrshare analytics shape
# ---------------------------------------------------------------------------

SAMPLE_RESPONSE = {
    "id": PROVIDER_POST_ID,
    "analytics": {
        "tiktok": {
            "views": 4200,
            "likes": 120,
            "comments": 15,
            "shares": 30,
            "saved": 8,
            "totalWatchTime": 18900.0,
            "averageWatchTime": 4.5,
            "completionRate": 0.42,
            "reach": 3800,
            "impressions": 4600,
        }
    },
}


async def test_parses_successful_response(patch_async_client):
    def _handler(request: httpx.Request) -> httpx.Response:
        assert "/analytics/post" in request.url.path
        assert request.headers["authorization"] == "Bearer ayr-test-key"
        return httpx.Response(200, json=SAMPLE_RESPONSE)

    patch_async_client(httpx.MockTransport(_handler))
    result = await fetch_post_analytics(PROVIDER_POST_ID, platforms=["tiktok"])

    assert result["id"] == PROVIDER_POST_ID
    assert result["analytics"]["tiktok"]["views"] == 4200
    assert result["analytics"]["tiktok"]["completionRate"] == 0.42


async def test_request_body_contains_id_and_platforms(patch_async_client):
    import json

    captured: dict = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": PROVIDER_POST_ID})

    patch_async_client(httpx.MockTransport(_handler))
    await fetch_post_analytics(PROVIDER_POST_ID, platforms=["tiktok", "reels"])

    assert captured["body"]["id"] == PROVIDER_POST_ID
    assert captured["body"]["platforms"] == ["tiktok", "reels"]


# ---------------------------------------------------------------------------
# 4xx / 5xx → AyrshareAnalyticsError
# ---------------------------------------------------------------------------

async def test_401_raises_analytics_error(patch_async_client):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Unauthorized"})

    patch_async_client(httpx.MockTransport(_handler))
    with pytest.raises(AyrshareAnalyticsError, match="401"):
        await fetch_post_analytics(PROVIDER_POST_ID, platforms=["tiktok"])


async def test_500_raises_analytics_error(patch_async_client):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Internal Server Error")

    patch_async_client(httpx.MockTransport(_handler))
    with pytest.raises(AyrshareAnalyticsError, match="500"):
        await fetch_post_analytics(PROVIDER_POST_ID, platforms=["tiktok"])


# ---------------------------------------------------------------------------
# 200 with empty body → returns {} cleanly (no KeyError)
# ---------------------------------------------------------------------------

async def test_200_empty_body_returns_empty_dict(patch_async_client):
    def _handler(request: httpx.Request) -> httpx.Response:
        # Empty JSON object
        return httpx.Response(200, json={})

    patch_async_client(httpx.MockTransport(_handler))
    result = await fetch_post_analytics(PROVIDER_POST_ID, platforms=["tiktok"])
    assert result == {}
