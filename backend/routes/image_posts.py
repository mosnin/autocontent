"""Image posts: stills + carousels.

- GET  /api/v1/image-posts               — list
- POST /api/v1/image-posts               — enqueue (spawns the Modal run)
- GET  /api/v1/image-posts/{id}          — detail
- POST /api/v1/image-posts/{id}/approve  — resume an awaiting_approval post
- POST /api/v1/image-posts/{id}/reject   — veto an awaiting_approval post
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from marketer import rails
from marketer.rails.http import rails_request_context, to_http
from marketer.repos import image_posts as image_posts_repo
from marketer.repos import niches as niches_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter(dependencies=[Depends(rails_request_context)])


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


@router.post("/{image_post_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_image_post(image_post_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Re-run a failed post from the top (fresh plan + renders)."""
    # Never re-post over an unknown outcome a person has not resolved.
    try:
        await rails.assert_no_unresolved(ctx.user_id, "carousel_post", str(image_post_id))
    except rails.RailsDenied as e:
        raise to_http(e) from e
    if not await image_posts_repo.claim_for_retry(image_post_id, user_id=ctx.user_id):
        existing = await image_posts_repo.get(image_post_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"post is {existing['status']}, not failed",
        )
    import modal

    fn = modal.Function.from_name("marketer-sh", "run_image_post")
    fn.spawn(ctx.user_id, str(image_post_id))
    return {"status": "queued"}


@router.post("/{image_post_id}/approve", status_code=status.HTTP_202_ACCEPTED)
async def approve_image_post(image_post_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Operator sign-off: atomically claim and resume at scheduling."""
    try:
        dispatch = await rails.enforce_dispatch(
            "content.carousel.approve", user_id=ctx.user_id,
            principal=rails.principal_of(ctx), actor_email=ctx.email,
            args={"image_post_id": image_post_id},
            target_type="image_post", target_id=str(image_post_id),
        )
    except rails.RailsDenied as e:
        raise to_http(e) from e
    if not await image_posts_repo.claim_for_scheduling(
        image_post_id, user_id=ctx.user_id
    ):
        await dispatch.failed("post not awaiting_approval")
        existing = await image_posts_repo.get(image_post_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"post is {existing['status']}, not awaiting_approval",
        )
    import modal

    fn = modal.Function.from_name("marketer-sh", "finish_image_post")

    async def _spawn() -> None:
        fn.spawn(ctx.user_id, str(image_post_id))

    try:
        await dispatch.run(_spawn)
    except rails.OutcomeUnknown as e:
        raise to_http(e) from e
    return {"status": "scheduling"}


@router.post("/{image_post_id}/reject")
async def reject_image_post(image_post_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Operator veto on an `awaiting_approval` post (parity with job reject):
    atomically marked failed so it never posts. Slides are kept."""
    try:
        dispatch = await rails.enforce_dispatch(
            "content.carousel.reject", user_id=ctx.user_id,
            principal=rails.principal_of(ctx), actor_email=ctx.email,
            args={"image_post_id": image_post_id},
            target_type="image_post", target_id=str(image_post_id),
        )
    except rails.RailsDenied as e:
        raise to_http(e) from e
    post = await image_posts_repo.claim_for_rejection(image_post_id, user_id=ctx.user_id)
    if post is None:
        await dispatch.failed("post not awaiting_approval")
        existing = await image_posts_repo.get(image_post_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"post is {existing['status']}, not awaiting_approval",
        )
    await dispatch.succeeded()
    return post
