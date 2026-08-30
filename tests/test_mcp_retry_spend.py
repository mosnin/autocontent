"""MCP retry / article generate tools actually hit the HTTP API.

Registration smoke in test_mcp_server.py only proves the names exist.
#59 covers approve / checkout / replay. #63 covers enqueue / ads / x402.
These remaining spend tools re-run a failed job or spawn an article —
a wiring miss (wrong path or swallowed 402/403) looks like success to
any agent using marketer-mcp.
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


def _article_row(*, article_id=None, status="queued") -> dict:
    return {
        "id": str(article_id or uuid4()),
        "user_id": "user_abc",
        "niche_id": str(uuid4()),
        "status": status,
        "topic": "how to test pipelines",
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


async def test_retry_job_posts_to_retry_path(monkeypatch, server):
    job_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(202, json=_job_row(job_id=job_id, status="queued"))

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool("retry_job", {"job_id": str(job_id)})

    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert req.url.path == f"/api/v1/jobs/{job_id}/retry"
    assert req.headers["authorization"] == "Bearer mkt_testtoken12345"
    assert json.loads(_text(out))["id"] == str(job_id)


async def test_retry_job_surfaces_generate_kill_switch(monkeypatch, server):
    job_id = uuid4()

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "feature 'generate' is disabled"})

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="403") as ei:
        await server.call_tool("retry_job", {"job_id": str(job_id)})
    assert "generate" in str(ei.value)
    assert requests[0].url.path == f"/api/v1/jobs/{job_id}/retry"


async def test_retry_job_surfaces_unbilled_402(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402, json={"detail": "unbilled usage is disabled on this deployment"}
        )

    _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool("retry_job", {"job_id": str(uuid4())})
    assert "unbilled" in str(ei.value)


async def test_generate_article_posts_body(monkeypatch, server):
    niche_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(202, json=_article_row())

    requests = _install_transport(monkeypatch, handler)
    out = await server.call_tool(
        "generate_article", {"niche_id": str(niche_id), "topic": "spend caps"}
    )

    assert len(requests) == 1
    req = requests[0]
    assert req.method == "POST"
    assert req.url.path == "/api/v1/articles"
    assert json.loads(req.content) == {
        "niche_id": str(niche_id),
        "topic": "spend caps",
    }
    assert json.loads(_text(out))["status"] == "queued"


async def test_generate_article_surfaces_generate_kill_switch(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"detail": "feature 'generate' is disabled"})

    requests = _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="403") as ei:
        await server.call_tool(
            "generate_article", {"niche_id": str(uuid4()), "topic": "x"}
        )
    assert "generate" in str(ei.value)
    assert requests[0].url.path == "/api/v1/articles"


async def test_generate_article_surfaces_unbilled_402(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402, json={"detail": "unbilled usage is disabled on this deployment"}
        )

    _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool(
            "generate_article", {"niche_id": str(uuid4()), "topic": "x"}
        )
    assert "unbilled" in str(ei.value)


async def test_retry_article_posts_to_retry_path(monkeypatch, server):
    article_id = uuid4()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(202, json=_article_row(article_id=article_id))

    requests = _install_transport(monkeypatch, handler)
    await server.call_tool("retry_article", {"article_id": str(article_id)})

    assert requests[0].method == "POST"
    assert requests[0].url.path == f"/api/v1/articles/{article_id}/retry"


async def test_retry_article_surfaces_unbilled_402(monkeypatch, server):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402, json={"detail": "unbilled usage is disabled on this deployment"}
        )

    _install_transport(monkeypatch, handler)
    with pytest.raises(ToolError, match="402") as ei:
        await server.call_tool("retry_article", {"article_id": str(uuid4())})
    assert "unbilled" in str(ei.value)
