"""MCP generate / ads / x402 tools actually hit the HTTP API.

Registration smoke in test_mcp_server.py only proves the names exist.
#59 covers approve / checkout / replay. These remaining spend tools
enqueue a pipeline, change live ad spend, or start a wallet top-up —
a wiring miss (wrong path, swallowed 402/403, or treating x402's 402
envelope as an error) is a money leak for any agent using marketer-mcp.
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


def _job_row(*, job_id=None, status="queued") -> dict:
    return {
        "id": str(job_id or uuid4()),
        "user_id": "user_abc",
        "niche_id": str(uuid4()),
        "platform": "tiktok",
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "clips": [],
        "script": None,
        "audio": None,
        "rendered": None,
        "scheduled_for": None,
        "provider_post_id": None,
        "error": None,
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


async def test_enqueue_job_posts_body(monkeypatch, server):
    niche_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(202, json=_job_row(status="queued"))

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool(
        "enqueue_job", {"niche_id": str(niche_id), "platform": "reels"}
    )

    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert req.url.path == "/api/v1/jobs"
    assert req.headers["authorization"] == "Bearer mkt_testtoken12345"
    assert json.loads(req.content) == {
        "niche_id": str(niche_id),
        "platform": "reels",
    }
    assert json.loads(_text(out))["status"] == "queued"


async def test_enqueue_job_surfaces_generate_kill_switch(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "feature 'generate' is disabled"})

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="403") as ei:
        await server.call_tool(
            "enqueue_job", {"niche_id": str(uuid4()), "platform": "tiktok"}
        )
    assert "generate" in str(ei.value)
    assert requests[0].url.path == "/api/v1/jobs"


async def test_enqueue_job_surfaces_unbilled_402(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402, json={"detail": "unbilled usage is disabled on this deployment"}
        )

    _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool(
            "enqueue_job", {"niche_id": str(uuid4()), "platform": "shorts"}
        )
    assert "unbilled" in str(ei.value)


async def test_change_ad_status_activate_surfaces_402(monkeypatch, server):
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content)
        return httpx.Response(402, json={"detail": "account kill-switch is engaged"})

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool(
            "change_ad_status", {"campaign_id": "c1", "status": "active"}
        )
    assert "kill-switch" in str(ei.value)
    assert requests[0].method == "POST"
    assert requests[0].url.path == "/api/v1/ads/campaigns/c1/status"
    assert captured["body"] == {"status": "active"}


async def test_change_ad_budget_surfaces_402(monkeypatch, server):
    def handler(req: httpx.Request) -> httpx.Response:
        assert json.loads(req.content) == {"daily_budget_usd": "100"}
        return httpx.Response(402, json={"detail": "account kill-switch is engaged"})

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool(
            "change_ad_budget", {"campaign_id": "c1", "daily_budget_usd": "100"}
        )
    assert "kill-switch" in str(ei.value)
    assert requests[0].url.path == "/api/v1/ads/campaigns/c1/budget"


async def test_change_ad_budget_pending_approval_passthrough(monkeypatch, server):
    def handler(req: httpx.Request) -> httpx.Response:
        assert json.loads(req.content) == {"daily_budget_usd": "100"}
        return httpx.Response(
            200, json={"status": "pending_approval", "approval_id": "ap1"}
        )

    _install_transport(monkeypatch, handler)
    out = await server.call_tool(
        "change_ad_budget", {"campaign_id": "c1", "daily_budget_usd": "100"}
    )
    payload = json.loads(_text(out))
    assert payload["status"] == "pending_approval"
    assert payload["approval_id"] == "ap1"


async def test_x402_buy_credits_without_header_is_payment_required(monkeypatch, server):
    """The first hop is a 402 envelope — not a ToolError. Agents must see
    the requirements so they can sign and retry with payment_header."""

    def handler(req: httpx.Request) -> httpx.Response:
        assert "x-payment" not in {k.lower() for k in req.headers}
        return httpx.Response(
            402, json={"x402Version": 1, "accepts": [{"scheme": "exact"}]}
        )

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool("x402_buy_credits", {"amount_usd": "10"})
    payload = json.loads(_text(out))
    assert payload["status"] == "payment_required"
    assert payload["requirements"]["accepts"][0]["scheme"] == "exact"
    assert requests[0].method == "POST"
    assert requests[0].url.path == "/api/v1/x402/credits"
    assert requests[0].url.params["amount_usd"] == "10"


async def test_x402_buy_credits_with_header_credits(monkeypatch, server):
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers.get("x-payment") == "base64payload"
        return httpx.Response(
            200,
            json={"credited_usd": "10.00", "balance_usd": "10.00"},
            headers={"X-PAYMENT-RESPONSE": "resp64"},
        )

    _install_transport(monkeypatch, handler)
    out = await server.call_tool(
        "x402_buy_credits",
        {"amount_usd": "10", "payment_header": "base64payload"},
    )
    payload = json.loads(_text(out))
    assert payload["status"] == "credited"
    assert payload["credited_usd"] == "10.00"
    assert payload["payment_response"] == "resp64"
