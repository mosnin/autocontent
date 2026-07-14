"""MCP server that exposes the marketer SDK to LLM agents over stdio.

Reads ``MARKETER_API_BASE_URL`` and ``MARKETER_API_TOKEN`` from the
environment at startup. Tool descriptions are written for an LLM caller —
they call out the side-effects and rough cost of each action so the model
can decide whether to confirm with the user first.

Run via:
    marketer-mcp
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

from mcp.server.fastmcp import FastMCP

from .models import (
    Job,
    JobStatus,
    Niche,
    NicheCreatePayload,
    PersonalAccessToken,
    TodaySpend,
)
from .sdk import ENV_BASE_URL, ENV_TOKEN, MarketerClient


def _dump(model: Any) -> str:
    if isinstance(model, list):
        return json.dumps([json.loads(m.model_dump_json()) for m in model], indent=2)
    return model.model_dump_json(indent=2)


def build_server(*, base_url: str | None = None, token: str | None = None) -> FastMCP:
    """Construct the MCP server with tools + resources registered.

    Exposed as a function so tests can call it without entering the stdio
    loop. The returned object is a configured ``FastMCP`` instance.
    """
    mcp = FastMCP("marketer")

    def _client() -> MarketerClient:
        return MarketerClient(base_url=base_url, token=token)

    # ------------------------------------------------------------- niches

    @mcp.tool(description=(
        "List the caller's active niches (content verticals). Cheap, read-only. "
        "Use this whenever the user asks about their niches or you need a niche_id "
        "for another call."
    ))
    async def list_niches() -> str:
        async with _client() as c:
            return _dump(await c.list_niches())

    @mcp.tool(description=(
        "Fetch one niche by its UUID. Cheap, read-only. Use after list_niches when "
        "the user wants the full prompt/voice/scheduling configuration."
    ))
    async def get_niche(niche_id: str) -> str:
        async with _client() as c:
            return _dump(await c.get_niche(niche_id))

    @mcp.tool(description=(
        "Create a new niche. NicheCreatePayload is large and every field is required "
        "by the pipeline; if any are missing, ask the user before guessing. Creating "
        "a niche has no immediate cost — runs only happen when enqueue_job is called."
    ))
    async def create_niche(payload: NicheCreatePayload) -> str:
        async with _client() as c:
            return _dump(await c.create_niche(payload))

    @mcp.tool(description=(
        "Soft-delete (archive) a niche. The niche stops appearing in lists but "
        "historical jobs / spend remain. Confirm with the user before calling."
    ))
    async def archive_niche(niche_id: str) -> dict[str, bool]:
        async with _client() as c:
            await c.archive_niche(niche_id)
            return {"ok": True}

    # ------------------------------------------------------------- jobs

    @mcp.tool(description=(
        "List recent pipeline jobs for the caller. Read-only and cheap. "
        "Pass status to filter (e.g. 'failed' to triage) and limit to bound output."
    ))
    async def list_jobs(status: JobStatus | None = None, limit: int = 50) -> str:
        async with _client() as c:
            return _dump(await c.list_jobs(status=status, limit=limit))

    @mcp.tool(description=(
        "Fetch one job by UUID, including its script, scenes, and error. Cheap, read-only."
    ))
    async def get_job(job_id: str) -> str:
        async with _client() as c:
            return _dump(await c.get_job(job_id))

    @mcp.tool(description=(
        "Enqueue a brand-new pipeline run for a niche on a platform "
        "(tiktok|reels|shorts). EXPENSIVE: spawns a Modal pipeline run that bills "
        "roughly $1.80 for a 6-scene 480p niche and consumes the niche's daily "
        "spend cap. Always confirm with the user before triggering one."
    ))
    async def enqueue_job(niche_id: str, platform: str) -> str:
        async with _client() as c:
            return _dump(await c.enqueue_job(niche_id=niche_id, platform=platform))

    @mcp.tool(description=(
        "Re-run a previously failed job from scratch. Only works on jobs in the "
        "'failed' state. Same cost profile as enqueue_job — confirm with the user."
    ))
    async def retry_job(job_id: str) -> str:
        async with _client() as c:
            return _dump(await c.retry_job(job_id))

    # ------------------------------------------------------------- articles

    @mcp.tool(description=(
        "List the user's SEO articles, newest first. Cheap, read-only. Filter "
        "by status (queued|researching|outlining|writing|qa|metadata|imaging|"
        "done|failed) and/or niche_id."
    ))
    async def list_articles(
        status: str | None = None, niche_id: str | None = None, limit: int = 50
    ) -> str:
        async with _client() as c:
            return _dump(await c.list_articles(status=status, niche_id=niche_id, limit=limit))

    @mcp.tool(description=(
        "Fetch one article: status, SEO metadata (title/slug/meta description/"
        "keywords/JSON-LD), quality score, and internal-link suggestions. "
        "Cheap, read-only."
    ))
    async def get_article(article_id: str) -> str:
        async with _client() as c:
            return _dump(await c.get_article(article_id))

    @mcp.tool(description=(
        "Download a finished article's full markdown body. Cheap, read-only."
    ))
    async def get_article_markdown(article_id: str) -> str:
        async with _client() as c:
            return await c.get_article_markdown(article_id)

    @mcp.tool(description=(
        "Generate a new SEO article for a niche: SERP research, outline, "
        "long-form writing, QA scoring, metadata + JSON-LD schema, hero image. "
        "Omit topic to let the pipeline pick the next best topic for the niche. "
        "EXPENSIVE: spawns a Modal run billing roughly $0.10-0.50 in LLM + image "
        "spend against the niche's daily cap. Confirm with the user first."
    ))
    async def generate_article(niche_id: str, topic: str = "") -> str:
        async with _client() as c:
            return _dump(await c.generate_article(niche_id=niche_id, topic=topic))

    @mcp.tool(description=(
        "Re-run a previously failed article from scratch (same topic). Same "
        "cost profile as generate_article — confirm with the user."
    ))
    async def retry_article(article_id: str) -> str:
        async with _client() as c:
            return _dump(await c.retry_article(article_id))

    # ------------------------------------------------------------- spend

    @mcp.tool(description=(
        "Today's USD spend, broken down by niche. Cheap, read-only. Use before "
        "enqueueing jobs to check headroom against per-niche daily caps."
    ))
    async def today_spend() -> str:
        async with _client() as c:
            return _dump(await c.today_spend())

    # ------------------------------------------------------------- connect

    @mcp.tool(description=(
        "Start the Ayrshare connect flow. Returns a login_url the user must open "
        "in a browser to link TikTok / Instagram / YouTube. Idempotent: safe to "
        "call even if already connected (returns a fresh URL)."
    ))
    async def connect_ayrshare() -> str:
        async with _client() as c:
            return _dump(await c.connect_ayrshare())

    # ------------------------------------------------------------- resources

    @mcp.resource("marketer://niches")
    async def res_niches() -> str:
        async with _client() as c:
            return _dump(await c.list_niches())

    @mcp.resource("marketer://niches/{niche_id}")
    async def res_niche(niche_id: str) -> str:
        async with _client() as c:
            return _dump(await c.get_niche(niche_id))

    @mcp.resource("marketer://jobs")
    async def res_jobs() -> str:
        async with _client() as c:
            return _dump(await c.list_jobs())

    @mcp.resource("marketer://articles")
    async def res_articles() -> str:
        async with _client() as c:
            return _dump(await c.list_articles())

    @mcp.resource("marketer://articles/{article_id}")
    async def res_article(article_id: str) -> str:
        async with _client() as c:
            return _dump(await c.get_article(article_id))

    @mcp.resource("marketer://jobs/{job_id}")
    async def res_job(job_id: str) -> str:
        async with _client() as c:
            return _dump(await c.get_job(job_id))

    # Touch the unused imports so static analysis doesn't strip them.
    _ = (Job, Niche, PersonalAccessToken, TodaySpend)

    return mcp


def main() -> int:
    base_url = os.environ.get(ENV_BASE_URL, "").strip()
    token = os.environ.get(ENV_TOKEN, "").strip()
    if not base_url or not token:
        print(
            f"marketer-mcp: {ENV_BASE_URL} and {ENV_TOKEN} must both be set.",
            file=sys.stderr,
        )
        return 2
    server = build_server(base_url=base_url, token=token)
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
