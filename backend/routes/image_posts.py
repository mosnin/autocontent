"""Image posts: stills + carousels.

- GET  /api/v1/image-posts               — list
- POST /api/v1/image-posts               — enqueue (spawns the Modal run)
- GET  /api/v1/image-posts/{id}          — detail
- POST /api/v1/image-posts/{id}/approve  — resume an awaiting_approval post
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from marketer.repos import image_posts as image_posts_repo
from marketer.repos import niches as niches_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class ImagePostCreate(BaseModel):
    niche_id: UUID
    kind: Literal["single", "carousel"] = "carousel"
    topic: str = ""
    slide_count: int = Field(default=5, ge=1, le=10)


@router.get("")
async def list_image_posts(
    status_filter: str | None = None, limit: int = 50, ctx: AuthCtx = CurrentUser
) -> list[dict]:
    return await image_posts_repo.list_for_user(
        ctx.user_id, status=status_filter, limit=min(max(limit, 1), 200)
    )


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def enqueue_image_post(
    body: ImagePostCreate, ctx: AuthCtx = CurrentUser
) -> dict:
    if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")
    post = await image_posts_repo.create(
        user_id=ctx.user_id, niche_id=body.niche_id, kind=body.kind,
        topic=body.topic.strip(), slide_count=body.slide_count,
    )
    import modal

    fn = modal.Function.from_name("marketer-sh", "run_image_post")
    fn.spawn(ctx.user_id, str(post["id"]))
    return post


@router.get("/{image_post_id}")
async def get_image_post(image_post_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    post = await image_posts_repo.get(image_post_id, user_id=ctx.user_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return post


@router.post("/{image_post_id}/approve", status_code=status.HTTP_202_ACCEPTED)
async def approve_image_post(image_post_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Operator sign-off: atomically claim and resume at scheduling."""
    if not await image_posts_repo.claim_for_scheduling(
        image_post_id, user_id=ctx.user_id
    ):
        existing = await image_posts_repo.get(image_post_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"post is {existing['status']}, not awaiting_approval",
        )
    import modal

    fn = modal.Function.from_name("marketer-sh", "finish_image_post")
    fn.spawn(ctx.user_id, str(image_post_id))
    return {"status": "scheduling"}
