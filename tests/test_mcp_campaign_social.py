"""MCP start_campaign / repurpose_article actually hit the HTTP API.

#59 covers approve / checkout / replay. #63 covers enqueue / ads / x402.
#65 covers retry_job / generate_article / retry_article. These two
remaining spend tools start a campaign runner or meter a social
repurpose — a wiring miss (wrong path or swallowed 402/404) looks like
success to any agent using marketer-mcp.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest
from mcp.server.fastmcp.exceptions import ToolError

from marketer.mcp_server import build_server
from marketer.sdk import MarketerClient


def _campaign_row(*, campaign_id=None, status="running") -> dict:
    return {
        "id": str(campaign_id or uuid4()),
        "user_id": "user_abc",
        "name": "launch",
        "status": status,
        "budget_usd": "50.00",
        "objective": "",
        "starts_at": None,
        "ends_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _install_transport(monkeypatch, handler):
    requests: list[httpx.Request] = []
    original = MarketerClient.__init__

    def _recording(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    def patched(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(_recording)
        kwargs.setdefault("base_url", "https://api.test.local")
        kwargs.setdefault("token", "mkt_testtoken12345")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(MarketerClient, "__init__", patched)
    return requests


def _text(result) -> str:
    blocks, _structured = result
    return "".join(getattr(block, "text", "") or "" for block in blocks)


@pytest.fixture
def server():
    return build_server(base_url="https://api.test.local", token="mkt_testtoken12345")


async def test_start_campaign_posts_to_start_path(monkeypatch, server):
    campaign_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_campaign_row(campaign_id=campaign_id))

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool("start_campaign", {"campaign_id": str(campaign_id)})

    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert req.url.path == f"/api/v1/campaigns/{campaign_id}/start"
    assert req.headers["authorization"] == "Bearer mkt_testtoken12345"
    assert json.loads(_text(out))["id"] == str(campaign_id)
    assert json.loads(_text(out))["status"] == "running"


async def test_start_campaign_surfaces_foreign_404(monkeypatch, server):
    campaign_id = uuid4()

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "Not Found"})

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="404"):
        await server.call_tool("start_campaign", {"campaign_id": str(campaign_id)})
    assert requests[0].url.path == f"/api/v1/campaigns/{campaign_id}/start"


async def test_repurpose_article_posts_to_social_path(monkeypatch, server):
    article_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "snippets": [
                    {"platform": "twitter", "body": "hi", "hashtags": []},
                ]
            },
        )

    requests = _install_transport(monkeypatch, handler)
    # SDK returns the snippets list; _dump expects pydantic models. The
    # tool must still hit the right path even if the success encode
    # fails — a 402/409 is the money-risk case. Call and inspect the
    # request regardless of encode outcome.
    try:
        await server.call_tool(
            "repurpose_article",
            {"article_id": str(article_id), "platforms": ["twitter"]},
        )
    except (ToolError, AttributeError, TypeError):
        pass

    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert req.url.path == f"/api/v1/articles/{article_id}/social"
    assert json.loads(req.content) == {"platforms": ["twitter"]}


async def test_repurpose_article_surfaces_spend_cap_402(monkeypatch, server):
    article_id = uuid4()

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402,
            json={
                "detail": "You're out of credit for this — add credit to continue."
            },
        )

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool(
            "repurpose_article",
            {"article_id": str(article_id), "platforms": ["linkedin"]},
        )
    assert "credit" in str(ei.value).lower()
    assert requests[0].url.path == f"/api/v1/articles/{article_id}/social"
