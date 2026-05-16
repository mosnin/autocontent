"""MCP server registration smoke test — no stdio loop, no real backend."""
from __future__ import annotations

import pytest

from autocontent import mcp_server


@pytest.fixture
def server():
    return mcp_server.build_server(base_url="http://localhost", token="act_dummy12345678")


async def test_tools_registered(server):
    tools = await server.list_tools()
    names = {t.name for t in tools}
    expected = {
        "list_niches", "get_niche", "create_niche", "archive_niche",
        "list_jobs", "get_job", "enqueue_job", "retry_job",
        "today_spend", "connect_ayrshare",
    }
    assert expected.issubset(names), f"missing tools: {expected - names}"


async def test_expensive_tools_warn_in_description(server):
    """The LLM needs to know enqueue_job and retry_job spend real money."""
    tools = {t.name: t for t in await server.list_tools()}
    enqueue_desc = (tools["enqueue_job"].description or "").lower()
    assert "expensive" in enqueue_desc or "$" in enqueue_desc
    assert "confirm" in enqueue_desc
    retry_desc = (tools["retry_job"].description or "").lower()
    assert "confirm" in retry_desc


async def test_resources_registered(server):
    resources = await server.list_resource_templates()
    uris = {str(r.uriTemplate) for r in resources}
    # The two parameterised ones come back as templates.
    assert "autocontent://niches/{niche_id}" in uris
    assert "autocontent://jobs/{job_id}" in uris


def test_main_requires_env(monkeypatch, capsys):
    monkeypatch.delenv("AUTOCONTENT_API_BASE_URL", raising=False)
    monkeypatch.delenv("AUTOCONTENT_API_TOKEN", raising=False)
    rc = mcp_server.main()
    assert rc == 2
    err = capsys.readouterr().err
    assert "AUTOCONTENT_API_BASE_URL" in err
