"""Bulk article generation from a keyword list (docs/seo-articles.md).

POST /api/v1/article-batches             content:create  queue one article per keyword
GET  /api/v1/article-batches             content:read    recent batches with item status
GET  /api/v1/article-batches/{id}        content:read
POST /api/v1/article-batches/{id}/cancel content:update  stop the items that haven't started
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.articles import bulk
from marketer.repos import article_batches as batches_repo
from marketer.repos.article_batches import Batch

from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

router = APIRouter()


class BatchBody(BaseModel):
    niche_id: UUID
    # A list, or one string with a keyword per line.
    keywords: list[str] | str = Field(max_length=20_000)


@router.post("", response_model=Batch, status_code=status.HTTP_202_ACCEPTED, dependencies=[user_rate_limit("articles.bulk", "5/minute")])
async def create_batch(body: BatchBody, ctx: AuthCtx = CurrentUser) -> Batch:
    if isinstance(body.keywords, list) and len(body.keywords) > 500:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "too many keywords")
    try:
        batch = await bulk.create(
            user_id=ctx.user_id, niche_id=body.niche_id, keywords=body.keywords,
            created_by=ctx.actor_id or ctx.user_id,
        )
    except bulk.BulkRefused as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    # Start the first items now; the seo_tick cron carries on from here.
    await bulk.tick_batch(batch.id, user_id=ctx.user_id, spawn=bulk.modal_spawn)
    return await batches_repo.get(batch.id, user_id=ctx.user_id) or batch


@router.get("", response_model=list[Batch])
async def list_batches(ctx: AuthCtx = CurrentUser) -> list[Batch]:
    return await batches_repo.list_for_user(ctx.user_id)


@router.get("/{batch_id}", response_model=Batch)
async def get_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> Batch:
    batch = await batches_repo.get(batch_id, user_id=ctx.user_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return batch


@router.post("/{batch_id}/cancel", response_model=Batch)
async def cancel_batch(batch_id: UUID, ctx: AuthCtx = CurrentUser) -> Batch:
    if not await batches_repo.cancel(batch_id, user_id=ctx.user_id):
        if await batches_repo.get(batch_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(status.HTTP_409_CONFLICT, "the batch has already finished")
    out = await batches_repo.get(batch_id, user_id=ctx.user_id)
    assert out is not None
    return out
