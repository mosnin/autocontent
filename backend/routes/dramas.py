"""Micro-drama endpoints — the screenplay/cast/shot-list surface.

POST enqueues a Modal pipeline run (202 + the queued row whose id
progresses); GETs are list/detail plus two ownership-scoped media streams.
Same contract shape as /jobs and /articles.
"""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from marketer.drama.schemas import (
    DEFAULT_SHOTS,
    MAX_SHOTS,
    MIN_SHOTS,
    Aspect,
    Drama,
    DramaStatus,
    Screenplay,
)
from marketer.repos import dramas as dramas_repo

from ..auth import AuthCtx, CurrentUser
from ..hosted_safety import refuse_unbilled_generate

router = APIRouter()

_MODAL_APP = "marketer-sh"
_MODAL_FN = "run_drama_pipeline"


class DramaEnqueue(BaseModel):
    niche_id: UUID
    # Exactly one of idea / script. A supplied script skips the screenwriter
    # stage entirely (and its spend).
    idea: str = Field(default="", max_length=4000)
    script: str | None = Field(default=None, max_length=20000)
    shot_count: int = Field(default=DEFAULT_SHOTS, ge=MIN_SHOTS, le=MAX_SHOTS)
    aspect: Aspect = "9:16"

    @model_validator(mode="after")
    def _one_source(self) -> DramaEnqueue:
        if not self.idea.strip() and not (self.script or "").strip():
            raise ValueError("supply either `idea` or `script`")
        return self


class CharacterView(BaseModel):
    """Cast member as the UI sees it — the portrait is a URL, not a path."""

    id: str
    name: str
    role: str
    static_features: str
    wardrobe: str
    has_reference_image: bool


class ShotView(BaseModel):
    index: int
    status: str  # 'pending' | 'framed' | 'rendered'
    slugline: str
    action: str
    dialogue: str
    character_ids: list[str]
    visual_prompt: str
    motion_prompt: str
    duration_sec: float
    has_keyframe: bool
    has_clip: bool


class DramaDetail(BaseModel):
    drama: Drama
    screenplay: Screenplay | None
    cast: list[CharacterView]
    shots: list[ShotView]
    has_video: bool


def _shot_status(has_clip: bool, has_prompts: bool) -> str:
    if has_clip:
        return "rendered"
    return "framed" if has_prompts else "pending"


@router.get("", response_model=list[Drama])
async def list_dramas(
    ctx: AuthCtx = CurrentUser,
    status_filter: DramaStatus | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[Drama]:
    return await dramas_repo.list_for_user(
        ctx.user_id, status=status_filter, limit=limit
    )


@router.get("/{drama_id}", response_model=DramaDetail)
async def get_drama(drama_id: UUID, ctx: AuthCtx = CurrentUser) -> DramaDetail:
    """The drama plus its screenplay, cast (with reference-image
    availability), and shots (status, prompts, clip availability)."""
    drama = await dramas_repo.get(drama_id, user_id=ctx.user_id)
    if drama is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    plan = drama.plan
    cast = [
        CharacterView(
            id=c.id,
            name=c.name,
            role=c.role,
            static_features=c.static_features,
            wardrobe=c.wardrobe,
            # Availability, not just intent: a path recorded for a file the
            # retention GC already swept must not render a broken <img>.
            has_reference_image=bool(
                c.reference_image_path and os.path.exists(c.reference_image_path)
            ),
        )
        for c in plan.cast
    ]
    shots = []
    for s in plan.shots:
        has_clip = bool(s.clip_path and os.path.exists(s.clip_path))
        shots.append(
            ShotView(
                index=s.index,
                status=_shot_status(has_clip, s.has_prompts),
                slugline=s.slugline,
                action=s.action,
                dialogue=s.dialogue,
                character_ids=s.character_ids,
                visual_prompt=s.visual_prompt,
                motion_prompt=s.motion_prompt,
                duration_sec=s.duration_sec,
                has_keyframe=bool(
                    s.keyframe_path and os.path.exists(s.keyframe_path)
                ),
                has_clip=has_clip,
            )
        )
    return DramaDetail(
        drama=drama,
        screenplay=plan.screenplay,
        cast=cast,
        shots=shots,
        has_video=bool(drama.video_path and os.path.exists(drama.video_path)),
    )


@router.post("", response_model=Drama, status_code=status.HTTP_202_ACCEPTED)
async def enqueue_drama(body: DramaEnqueue, ctx: AuthCtx = CurrentUser) -> Drama:
    """Create the drama row and spawn the Modal pipeline against it.
    Poll GET /{drama_id} for status."""
    refuse_unbilled_generate()
    import modal

    from marketer.repos import niches as niches_repo

    # Ownership/existence check up front: a foreign niche_id would otherwise
    # insert a row that only fails inside the Modal container — and the niche
    # is what supplies the spend cap that gates the whole run.
    niche = await niches_repo.get(body.niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    drama = await dramas_repo.create(
        user_id=ctx.user_id,
        niche_id=body.niche_id,
        idea=body.idea.strip(),
        script=(body.script or "").strip(),
        shot_count=body.shot_count,
        aspect=body.aspect,
    )
    fn = modal.Function.from_name(_MODAL_APP, _MODAL_FN)
    fn.spawn(ctx.user_id, str(drama.id))
    return drama


@router.get("/{drama_id}/video")
async def get_drama_video(drama_id: UUID, ctx: AuthCtx = CurrentUser) -> FileResponse:
    """Stream the stitched mp4. Ownership-scoped; "missing drama", "no video
    yet", and "file gone from the volume" all collapse to 404 — the web client
    doesn't differentiate."""
    drama = await dramas_repo.get(drama_id, user_id=ctx.user_id)
    if drama is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if not drama.video_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no rendered video")
    if not os.path.exists(drama.video_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file missing")
    return FileResponse(drama.video_path, media_type="video/mp4")


@router.get("/{drama_id}/characters/{character_id}/image")
async def get_character_image(
    drama_id: UUID, character_id: str, ctx: AuthCtx = CurrentUser
) -> FileResponse:
    """Stream one character's locked reference portrait.

    The path is looked up in the drama's own plan — never derived from the
    caller's `character_id` — so a traversal-shaped id can't address a file
    outside this drama's cast.
    """
    drama = await dramas_repo.get(drama_id, user_id=ctx.user_id)
    if drama is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    character = drama.plan.character_by_id(character_id)
    if character is None or not character.reference_image_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no reference portrait")
    if not os.path.exists(character.reference_image_path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file missing")
    return FileResponse(character.reference_image_path, media_type="image/png")


@router.post(
    "/{drama_id}/retry", response_model=Drama, status_code=status.HTTP_202_ACCEPTED
)
async def retry_drama(drama_id: UUID, ctx: AuthCtx = CurrentUser) -> Drama:
    """Resume a failed drama. The plan is kept, so the screenplay, locked
    portraits, and already-rendered shots are inherited rather than re-bought."""
    refuse_unbilled_generate()
    import modal

    drama = await dramas_repo.claim_for_retry(drama_id, user_id=ctx.user_id)
    if drama is None:
        # Either absent/foreign, or not failed (including a concurrent retry
        # that already claimed it) — atomic, so no double-spawn.
        existing = await dramas_repo.get(drama_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"drama is {existing.status.value}, not failed",
        )
    fn = modal.Function.from_name(_MODAL_APP, _MODAL_FN)
    fn.spawn(ctx.user_id, str(drama.id))
    return drama
