"""Failures inbox — a consolidated, categorized view of terminal failures
across a user's work.

Today failures are scattered: a job's `error` is only visible on that
job's detail page, an image post's on its own list, an article's on
its own. When something goes wrong there is no single place to see
*what* failed and *why*, across content types, so operators either miss
failures or have to hunt product-by-product. This router is read-mostly:

- ``GET  /api/v1/failures``            recent failures across jobs (and,
  cheaply, image posts + articles), each tagged with a coarse category
  derived from its ``error`` text, plus per-category counts.
- ``POST /api/v1/failures/replay/{kind}/{id}``
  re-run a single failed item. This does **not** invent a new spawn
  path — it reuses exactly the same repo calls and Modal function names
  as the existing per-surface retry endpoints
  (``POST /jobs/{id}/retry``, ``POST /image-posts/{id}/retry``,
  ``POST /articles/{id}/retry``), just addressable from the inbox by
  ``(kind, id)`` instead of requiring the caller to know which surface
  the failure came from.

Everything is scoped to ``ctx.user_id`` — this is a personal triage
view, not an admin cross-tenant one.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from marketer.articles.models import ArticleStatus
from marketer.repos import articles as articles_repo
from marketer.repos import image_posts as image_posts_repo
from marketer.repos import jobs as jobs_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

FailureKind = Literal["job", "image_post", "article"]


class FailureItem(BaseModel):
    kind: FailureKind
    id: UUID
    niche_id: UUID | None
    niche_title: str | None = None
    label: str  # platform (job) / kind (image post) / topic (article)
    error: str | None
    category: str
    created_at: datetime | None


class FailuresInboxResponse(BaseModel):
    failures: list[FailureItem]
    counts: dict[str, int]
    total: int


@router.get("", response_model=FailuresInboxResponse)
async def list_failures(
    ctx: AuthCtx = CurrentUser,
    limit: int = Query(default=100, ge=1, le=500),
) -> FailuresInboxResponse:
    """The caller's recent failures across jobs, image posts, and
    articles, newest first, each with a triage category attached.

    ``limit`` bounds *each* underlying query, not the merged total —
    keeping every source's most-recent window cheap and independent
    rather than paginating a UNION.
    """
    job_rows = await jobs_repo.failures_for_user(ctx.user_id, limit=limit)
    image_post_rows = await image_posts_repo.list_for_user(
        ctx.user_id, status="failed", limit=limit
    )
    article_rows = await articles_repo.list_for_user(
        ctx.user_id, status=ArticleStatus.failed, limit=limit
    )

    items: list[FailureItem] = []
    for r in job_rows:
        items.append(
            FailureItem(
                kind="job",
                id=r["id"],
                niche_id=r["niche_id"],
                niche_title=r["niche_title"],
                label=r["platform"],
                error=r["error"],
                category=r["category"],
                created_at=r["created_at"],
            )
        )
    for r in image_post_rows:
        items.append(
            FailureItem(
                kind="image_post",
                id=r["id"],
                niche_id=r.get("niche_id"),
                niche_title=None,
                label=r.get("kind", "image"),
                error=r.get("error"),
                category=jobs_repo.classify_failure(r.get("error")),
                created_at=r["created_at"],
            )
        )
    for a in article_rows:
        items.append(
            FailureItem(
                kind="article",
                id=a.id,
                niche_id=a.niche_id,
                niche_title=None,
                label=a.topic or "(untitled)",
                error=a.error,
                category=jobs_repo.classify_failure(a.error),
                created_at=a.created_at,
            )
        )

    # Articles can have a null created_at pre-migration/back-compat; sort
    # those last rather than letting None vs. datetime blow up the sort.
    items.sort(key=lambda i: i.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    counts: dict[str, int] = {c: 0 for c in jobs_repo.FAILURE_CATEGORIES}
    for i in items:
        counts[i.category] = counts.get(i.category, 0) + 1

    return FailuresInboxResponse(failures=items, counts=counts, total=len(items))


@router.post("/replay/{kind}/{item_id}", status_code=status.HTTP_202_ACCEPTED)
async def replay_failure(
    kind: FailureKind, item_id: UUID, ctx: AuthCtx = CurrentUser
) -> dict:
    """Replay a single failed item by delegating to the same repo call
    and Modal function the item's own retry endpoint uses. No new spawn
    logic is introduced here — this is the existing per-surface retry,
    just reachable from the consolidated inbox.
    """
    import modal

    if kind == "job":
        job = await jobs_repo.reset_for_retry(item_id, user_id=ctx.user_id)
        if job is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="job not found, not owned, or not in failed state",
            )
        fn = modal.Function.from_name("marketer-sh", "run_pipeline")
        fn.spawn(ctx.user_id, str(job.niche_id), job.platform, str(job.id))
        return {"kind": "job", "id": str(job.id), "status": job.status.value}

    if kind == "image_post":
        if not await image_posts_repo.claim_for_retry(item_id, user_id=ctx.user_id):
            existing = await image_posts_repo.get(item_id, user_id=ctx.user_id)
            if existing is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND)
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"post is {existing['status']}, not failed",
            )
        fn = modal.Function.from_name("marketer-sh", "run_image_post")
        fn.spawn(ctx.user_id, str(item_id))
        return {"kind": "image_post", "id": str(item_id), "status": "queued"}

    # kind == "article"
    article = await articles_repo.get(item_id, user_id=ctx.user_id)
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
    return {"kind": "article", "id": str(article.id), "status": "queued"}
