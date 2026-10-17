"""MCP approve / billing / replay tools actually hit the HTTP API.

Registration smoke in test_mcp_server.py only proves the names exist.
These tools publish to socials, start Stripe Checkout, and re-spend
generate credit — so a wiring miss (wrong path, swallowed 403/402)
is a real money or publish leak for any agent using marketer-mcp.
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


def _job_row(*, job_id=None, status="scheduling") -> dict:
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
    """Force every MarketerClient the MCP tools build onto MockTransport."""
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


async def test_approve_job_posts_to_approve_path(monkeypatch, server):
    job_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(202, json=_job_row(job_id=job_id, status="scheduling"))

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool("approve_job", {"job_id": str(job_id)})

    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert req.url.path == f"/api/v1/jobs/{job_id}/approve"
    assert req.headers["authorization"] == "Bearer mkt_testtoken12345"
    payload = json.loads(_text(out))
    assert payload["status"] == "scheduling"


async def test_approve_job_surfaces_publish_kill_switch(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "feature 'publish' is disabled"})

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="403") as ei:
        await server.call_tool("approve_job", {"job_id": str(uuid4())})
    assert "publish" in str(ei.value)
    assert len(requests) == 1
    assert requests[0].url.path.endswith("/approve")


async def test_reject_job_posts_to_reject_path(monkeypatch, server):
    job_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json=_job_row(job_id=job_id, status="failed")
        )

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool("reject_job", {"job_id": str(job_id)})

    assert requests[0].method == "POST"
    assert requests[0].url.path == f"/api/v1/jobs/{job_id}/reject"
    assert json.loads(_text(out))["status"] == "failed"


async def test_billing_checkout_posts_pack(monkeypatch, server):
    captured: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(req.content)
        return httpx.Response(200, json={"url": "https://checkout.stripe.com/c/pay/cs_test"})

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool("billing_checkout", {"pack": "creator"})

    assert requests[0].method == "POST"
    assert requests[0].url.path == "/api/v1/billing/checkout"
    assert captured["body"] == {"pack": "creator"}
    assert json.loads(_text(out))["url"].startswith("https://checkout.stripe.com/")


async def test_billing_checkout_surfaces_billing_flag_off(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "feature 'billing' is disabled"})

    _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="403") as ei:
        await server.call_tool("billing_checkout", {"pack": "starter"})
    assert "billing" in str(ei.value)


async def test_replay_failure_surfaces_unbilled_402(monkeypatch, server):
    """Replay is a generate path — a 402 must reach the agent, not look like success."""
    spawned = []

    def handler(req: httpx.Request) -> httpx.Response:
        spawned.append(req)
        return httpx.Response(
            402, json={"detail": "unbilled usage is disabled on this deployment"}
        )

    _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool(
            "replay_failure",
            {"kind": "job", "item_id": str(uuid4())},
        )
    assert "unbilled" in str(ei.value)
    assert spawned[0].method == "POST"
    assert "/api/v1/failures/replay/job/" in spawned[0].url.path
