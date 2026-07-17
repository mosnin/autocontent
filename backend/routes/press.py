"""Press planner — topic proposals (approval loop), publish targets, and
manual publishing. Scheduled/autopilot generation lives in
marketer.services.scheduler; this module is the human-facing surface for
the approval queue and the "last mile" publish action.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.articles.models import Article, ArticlePublish, ArticleStatus
from marketer.repos import articles as articles_repo
from marketer.repos import publish_targets as targets_repo
from marketer.repos import topic_proposals as proposals_repo
from marketer.repos.publish_targets import PublishTarget
from marketer.repos.topic_proposals import TopicProposal
from marketer.services.publishing import PublishError, publish_article

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


# ---------------------------------------------------------------------------
# Topic proposals — the approval loop
# ---------------------------------------------------------------------------


class TopicsGenerateBody(BaseModel):
    niche_id: UUID
    # Omit to use MARKETER_PRESS_TOPIC_BATCH.
    n: int | None = Field(default=None, ge=1, le=50)


@router.post("/topics/generate", response_model=list[TopicProposal])
async def generate_topics(
    body: TopicsGenerateBody, ctx: AuthCtx = CurrentUser
) -> list[TopicProposal]:
    """Propose a batch of candidate topics for a niche's approval queue.
    One metered LLM call (charged to the niche's daily cap), same spend
    contract as every other article LLM call."""
    from marketer.articles import llm
    from marketer.config import settings
    from marketer.repos import brand_kit as brand_kit_repo
    from marketer.repos import niches as niches_repo
    from marketer.repos.spend import SpendCapExceeded
    from marketer.services.spend_context import default_context

    niche = await niches_repo.get(body.niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    n = body.n or settings.press_topic_batch
    brand = await brand_kit_repo.get(ctx.user_id)
    recent = await articles_repo.recent_titles_for_niche(
        body.niche_id, user_id=ctx.user_id
    )
    spend = await default_context(
        user_id=ctx.user_id, niche_id=body.niche_id, job_id=None,
        cap_usd=niche.daily_spend_cap_usd,
    )
    try:
        picks = await llm.propose_topics(niche, brand, recent, n, spend=spend)
    except SpendCapExceeded as exc:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "topic generation failed") from exc

    return [
        await proposals_repo.create(
            user_id=ctx.user_id, niche_id=body.niche_id, title=p.title,
            focus_keyword=p.focusKeyword, rationale=p.rationale, score=p.score,
        )
        for p in picks
    ]


@router.get("/topics", response_model=list[TopicProposal])
async def list_topics(
    ctx: AuthCtx = CurrentUser,
    status_filter: str | None = Query(default=None, alias="status"),
    niche_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[TopicProposal]:
    if status_filter is not None and status_filter not in {"pending", "approved", "rejected"}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid status filter")
    return await proposals_repo.list_for_user(
        ctx.user_id, status=status_filter, niche_id=niche_id, limit=limit
    )


@router.post("/topics/{proposal_id}/approve", response_model=TopicProposal)
async def approve_topic(proposal_id: UUID, ctx: AuthCtx = CurrentUser) -> TopicProposal:
    proposal = await proposals_repo.decide(proposal_id, user_id=ctx.user_id, status="approved")
    if proposal is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "proposal not found or already decided"
        )
    return proposal


@router.post("/topics/{proposal_id}/reject", response_model=TopicProposal)
async def reject_topic(proposal_id: UUID, ctx: AuthCtx = CurrentUser) -> TopicProposal:
    proposal = await proposals_repo.decide(proposal_id, user_id=ctx.user_id, status="rejected")
    if proposal is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "proposal not found or already decided"
        )
    return proposal


# ---------------------------------------------------------------------------
# Publish targets
# ---------------------------------------------------------------------------


class PublishTargetCreate(BaseModel):
    kind: str  # 'wordpress' | 'webhook'
    name: str = Field(max_length=200)
    base_url: str = Field(max_length=2000)
    username: str = Field(default="", max_length=200)
    # WordPress application password, or the webhook HMAC signing secret.
    # Write-only: never echoed back by any response in this router.
    secret: str = Field(default="", max_length=2000)


@router.post("/targets", response_model=PublishTarget, status_code=status.HTTP_201_CREATED)
async def create_target(body: PublishTargetCreate, ctx: AuthCtx = CurrentUser) -> PublishTarget:
    if body.kind not in ("wordpress", "webhook"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "kind must be wordpress or webhook")
    if not body.secret:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "secret is required (application password for wordpress, HMAC secret for webhook)",
        )
    return await targets_repo.create(
        user_id=ctx.user_id, kind=body.kind, name=body.name, base_url=body.base_url,
        username=body.username, secret=body.secret,
    )


@router.get("/targets", response_model=list[PublishTarget])
async def list_targets(ctx: AuthCtx = CurrentUser) -> list[PublishTarget]:
    return await targets_repo.list_for_user(ctx.user_id)


@router.delete("/targets/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_target(target_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    deleted = await targets_repo.delete(target_id, user_id=ctx.user_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND)


# ---------------------------------------------------------------------------
# Publishing — the last mile
# ---------------------------------------------------------------------------


class PublishBody(BaseModel):
    target_id: UUID


@router.post("/articles/{article_id}/publish", response_model=ArticlePublish)
async def publish_article_route(
    article_id: UUID, body: PublishBody, ctx: AuthCtx = CurrentUser
) -> ArticlePublish:
    article: Article | None = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="article not found")
    if article.status != ArticleStatus.done or not article.article_markdown:
        raise HTTPException(status.HTTP_409_CONFLICT, "article is not finished yet")

    target = await targets_repo.get_with_secret(body.target_id, user_id=ctx.user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="publish target not found")
    if target.disabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "publish target is disabled")

    try:
        return await publish_article(article, target)
    except PublishError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/articles/{article_id}/publishes", response_model=list[ArticlePublish])
async def list_article_publishes(
    article_id: UUID, ctx: AuthCtx = CurrentUser
) -> list[ArticlePublish]:
    article = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await articles_repo.list_publishes(article_id, user_id=ctx.user_id)


# ---------------------------------------------------------------------------
# Research surfaces — cross-corpus internal-link opportunities
# ---------------------------------------------------------------------------


@router.get("/links")
async def link_opportunities(ctx: AuthCtx = CurrentUser) -> list[dict]:
    """Cross-corpus internal-link opportunities: every finished article's
    stored link_suggestions, filtered down to targets that still exist in
    the user's corpus (interlink_candidates) — a suggestion pointing at a
    since-deleted or since-renamed article is dropped rather than shown as
    a live opportunity."""
    candidates = await articles_repo.interlink_candidates(ctx.user_id, limit=200)
    valid_targets = {f"/{c['slug']}" for c in candidates}

    arts = await articles_repo.list_for_user(
        ctx.user_id, status=ArticleStatus.done, limit=200
    )
    out: list[dict] = []
    for a in arts:
        suggestions = [
            s.model_dump() for s in a.link_suggestions if s.targetUrl in valid_targets
        ]
        if suggestions:
            out.append({
                "article_id": str(a.id),
                "title": a.title or a.topic,
                "suggestions": suggestions,
            })
    return out
