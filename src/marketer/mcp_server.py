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

    @mcp.tool(description=(
        "Repurpose a finished article into platform-native social posts "
        "(twitter, linkedin, instagram, facebook, newsletter). Pass a subset "
        "of platforms or omit for all. MODERATE COST: one LLM call metered to "
        "the niche's daily cap. Returns a list of {platform, body, hashtags}."
    ))
    async def repurpose_article(article_id: str, platforms: list[str] | None = None) -> str:
        async with _client() as c:
            return _dump(await c.repurpose_article(article_id, platforms=platforms))

    # ------------------------------------------------------------- calendar

    @mcp.tool(description=(
        "The content calendar: scheduled video posts and article activity for "
        "the next N days (default 30). Cheap, read-only. Returns a time-ordered "
        "list of {kind, id, niche_id, title, status, platform, at}."
    ))
    async def calendar(days: int = 30) -> str:
        async with _client() as c:
            return _dump(await c.calendar(days=days))

    # ------------------------------------------------------------- brand kit

    @mcp.tool(description=(
        "Read the account's brand kit (name, tone, banned words, hashtags, "
        "accent color). Cheap, read-only. The brand kit steers new channel "
        "drafts so they come out on-brand."
    ))
    async def get_brand_kit() -> str:
        async with _client() as c:
            return _dump(await c.get_brand_kit())

    @mcp.tool(description=(
        "Update the account's brand kit. Pass any of: brand_name, tagline, "
        "tone_of_voice, target_audience, banned_words (list), "
        "preferred_hashtags (list), color_hex ('#rrggbb'). Cheap, no LLM spend. "
        "Affects future channel drafts, not existing channels."
    ))
    async def set_brand_kit(
        brand_name: str | None = None,
        tagline: str | None = None,
        tone_of_voice: str | None = None,
        target_audience: str | None = None,
        banned_words: list[str] | None = None,
        preferred_hashtags: list[str] | None = None,
        color_hex: str | None = None,
    ) -> str:
        fields = {
            k: v for k, v in {
                "brand_name": brand_name, "tagline": tagline,
                "tone_of_voice": tone_of_voice, "target_audience": target_audience,
                "banned_words": banned_words, "preferred_hashtags": preferred_hashtags,
                "color_hex": color_hex,
            }.items() if v is not None
        }
        async with _client() as c:
            return _dump(await c.set_brand_kit(**fields))

    # ------------------------------------------------------------- ads

    @mcp.tool(description=(
        "List the caller's connected ad accounts (Google Ads / Meta Ads) with "
        "status and governance (daily/monthly caps, kill-switch). Cheap, "
        "read-only."
    ))
    async def list_ad_accounts() -> str:
        async with _client() as c:
            return json.dumps(await c.list_ad_accounts(), indent=2)

    @mcp.tool(description=(
        "Start connecting an ad platform ('google_ads' or 'meta_ads'). Returns "
        "a redirect_url the USER must open to authorize — you cannot complete "
        "OAuth yourself. Returns a 409 error if ads aren't enabled for this "
        "workspace."
    ))
    async def connect_ad_account(platform: str) -> str:
        async with _client() as c:
            return json.dumps(await c.connect_ad_account(platform), indent=2)

    @mcp.tool(description=(
        "Ads dashboard summary: spend today / 30d, active campaigns, pending "
        "approvals. Cheap, read-only. Check this before proposing budget "
        "changes."
    ))
    async def ads_overview() -> str:
        async with _client() as c:
            return json.dumps(await c.ads_overview(), indent=2)

    @mcp.tool(description=(
        "List ad campaigns, optionally filtered to one account. Cheap, "
        "read-only."
    ))
    async def list_ad_campaigns(account_id: str | None = None) -> str:
        async with _client() as c:
            return json.dumps(await c.list_ad_campaigns(account_id=account_id), indent=2)

    @mcp.tool(description=(
        "Fetch one campaign plus its recent daily metrics (spend, clicks, "
        "conversions, revenue). Cheap, read-only."
    ))
    async def get_ad_campaign(campaign_id: str) -> str:
        async with _client() as c:
            return json.dumps(await c.get_ad_campaign(campaign_id), indent=2)

    @mcp.tool(description=(
        "Create a DRAFT ad campaign. NO SPEND — a draft is never on the "
        "platform until activated. daily_budget_usd is the intended budget, "
        "stored on the draft. Safe to call."
    ))
    async def create_ad_campaign(
        ad_account_id: str,
        name: str,
        objective: str = "",
        daily_budget_usd: str | None = None,
    ) -> str:
        async with _client() as c:
            return json.dumps(await c.create_ad_campaign(
                ad_account_id=ad_account_id, name=name, objective=objective,
                daily_budget_usd=daily_budget_usd,
            ), indent=2)

    @mcp.tool(description=(
        "Change a campaign's daily budget. SPEND-AFFECTING: this passes a "
        "fail-closed budget guard. A large increase returns "
        "{status:'pending_approval'} and does NOT take effect until a human "
        "approves it; a change over the account cap or with the kill-switch on "
        "returns a 402 error. Always confirm the number with the user first."
    ))
    async def change_ad_budget(campaign_id: str, daily_budget_usd: str) -> str:
        async with _client() as c:
            return json.dumps(await c.change_ad_budget(campaign_id, daily_budget_usd), indent=2)

    @mcp.tool(description=(
        "Activate, pause, or end a campaign (status = 'active'|'paused'|"
        "'ended'). Activating is spend-affecting and can be refused (402) by "
        "governance; pausing/ending always works. Confirm activation with the "
        "user."
    ))
    async def change_ad_status(campaign_id: str, status: str) -> str:
        async with _client() as c:
            return json.dumps(await c.change_ad_status(campaign_id, status), indent=2)

    @mcp.tool(description=(
        "List spend-change approvals (pass status='pending' to see what's "
        "awaiting a decision). Read-only."
    ))
    async def list_ad_approvals(status: str | None = None) -> str:
        async with _client() as c:
            return json.dumps(await c.list_ad_approvals(status=status), indent=2)

    @mcp.tool(description=(
        "Approve or reject a pending spend change (decision = 'approved'|"
        "'rejected'). Approving lets the change execute. This is a human "
        "decision — only call it when the user explicitly tells you to."
    ))
    async def decide_ad_approval(approval_id: str, decision: str) -> str:
        async with _client() as c:
            return json.dumps(await c.decide_ad_approval(approval_id, decision), indent=2)

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
