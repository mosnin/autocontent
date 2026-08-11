"""Article endpoints — the written-content/SEO surface.

POST enqueues a pipeline run on Modal (202 + the queued row whose id
progresses); GETs are list/detail/markdown-download. All scoped to the
authenticated user, same contract as /jobs.
"""
from __future__ import annotations

from uuid import UUID

import os

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from marketer.articles.models import Article, ArticleStatus
from marketer.repos import articles as articles_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class ArticleEnqueue(BaseModel):
    niche_id: UUID
    # Optional: omit to let the pipeline pick the next best topic for the
    # niche (deduped against recent articles).
    topic: str = Field(default="", max_length=500)


@router.get("", response_model=list[Article])
async def list_articles(
    ctx: AuthCtx = CurrentUser,
    status_filter: ArticleStatus | None = None,
    niche_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[Article]:
    return await articles_repo.list_for_user(
        ctx.user_id, status=status_filter, niche_id=niche_id, limit=limit
    )


@router.get("/{article_id}", response_model=Article)
async def get_article(article_id: UUID, ctx: AuthCtx = CurrentUser) -> Article:
    article = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return article


@router.get("/{article_id}/markdown")
async def get_article_markdown(
    article_id: UUID, ctx: AuthCtx = CurrentUser
) -> PlainTextResponse:
    article = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not article.article_markdown:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "article has no content yet")
    filename = f"{article.slug or article.id}.md"
    return PlainTextResponse(
        article.article_markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=Article, status_code=status.HTTP_202_ACCEPTED)
async def enqueue_article(body: ArticleEnqueue, ctx: AuthCtx = CurrentUser) -> Article:
    """Create the article row and spawn the Modal pipeline against it.
    Poll GET /{article_id} for status."""
    import modal

    from marketer.repos import niches as niches_repo

    niche = await niches_repo.get(body.niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    article = await articles_repo.create(
        user_id=ctx.user_id, niche_id=body.niche_id, topic=body.topic
    )
    fn = modal.Function.from_name("marketer-sh", "run_article_pipeline")
    fn.spawn(ctx.user_id, str(body.niche_id), str(article.id), body.topic)
    return article


class SocialRepurposeBody(BaseModel):
    # Empty = all platforms. Validated against the known set below.
    platforms: list[str] = Field(default_factory=list)


@router.post("/{article_id}/social")
async def repurpose_to_social(
    article_id: UUID, body: SocialRepurposeBody, ctx: AuthCtx = CurrentUser
) -> dict:
    """Repurpose a finished article into platform-native social posts. One
    metered LLM call (charged to the article's niche daily cap). The article
    must be done and have content."""
    from marketer.articles import llm
    from marketer.articles.models import ArticleStatus
    from marketer.repos import niches as niches_repo
    from marketer.services.spend_context import default_context

    article = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if article.status != ArticleStatus.done or not article.article_markdown:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "article is not finished yet"
        )
    niche = await niches_repo.get(article.niche_id, user_id=ctx.user_id)
    cap = niche.daily_spend_cap_usd if niche else None
    spend = await default_context(
        user_id=ctx.user_id, niche_id=article.niche_id, job_id=None,
        article_id=article.id, cap_usd=cap,
    )
    try:
        snippets = await llm.generate_social_snippets(
            article.title or article.topic, article.article_markdown,
            body.platforms, spend=spend,
        )
    except Exception as exc:  # noqa: BLE001
        # Cap tripped or provider error — surface a clean 4xx/5xx.
        from marketer.repos.spend import SpendCapExceeded
        if isinstance(exc, SpendCapExceeded):
            raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc)) from exc
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "generation failed") from exc
    return {"snippets": [s.model_dump() for s in snippets]}


@router.get("/{article_id}/hero-image")
async def get_article_hero(article_id: UUID, ctx: AuthCtx = CurrentUser) -> FileResponse:
    """Stream the article's editorial hero image (gpt-image-1 PNG).

    Ownership-scoped like every other media endpoint. 404 if the article is
    missing/foreign, has no hero, or the file isn't on the volume."""
    article = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    path = article.hero_image_path
    if not path or not os.path.exists(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no hero image")
    return FileResponse(path, media_type="image/png")


@router.post("/{article_id}/retry", response_model=Article, status_code=status.HTTP_202_ACCEPTED)
async def retry_article(article_id: UUID, ctx: AuthCtx = CurrentUser) -> Article:
    """Re-run a failed article from scratch (same row, same topic)."""
    import modal

    article = await articles_repo.claim_for_retry(article_id, user_id=ctx.user_id)
    if article is None:
        # Either not owned/absent, or not in failed state (incl. a concurrent
        # retry that already claimed it) — atomic, so no double-spawn.
        existing = await articles_repo.get(article_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"article is {existing.status.value}, not failed",
        )
    fn = modal.Function.from_name("marketer-sh", "run_article_pipeline")
    fn.spawn(ctx.user_id, str(article.niche_id), str(article.id), article.topic)
    return article
