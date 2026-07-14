"""Article endpoints — the written-content/SEO surface.

POST enqueues a pipeline run on Modal (202 + the queued row whose id
progresses); GETs are list/detail/markdown-download. All scoped to the
authenticated user, same contract as /jobs.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
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


@router.post("/{article_id}/retry", response_model=Article, status_code=status.HTTP_202_ACCEPTED)
async def retry_article(article_id: UUID, ctx: AuthCtx = CurrentUser) -> Article:
    """Re-run a failed article from scratch (same row, same topic)."""
    import modal

    article = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if article.status != ArticleStatus.failed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"article is {article.status.value}, not failed",
        )
    article.status = ArticleStatus.queued
    article.error = None
    await articles_repo.save(article)
    fn = modal.Function.from_name("marketer-sh", "run_article_pipeline")
    fn.spawn(ctx.user_id, str(article.niche_id), str(article.id), article.topic)
    return article
