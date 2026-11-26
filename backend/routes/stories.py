"""Story videos: an idea or a script becomes a multi-shot video (docs/story-video.md).

Writes return 202 with the story; the background stage moves it on. Poll
GET /{story_id}. Permissions are in backend/policy.py: reading needs
content:read, making and editing content:create, approving a large render
spend:approve.
"""
from __future__ import annotations

import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.rails.enforce import OutcomeUnknown, RailsDenied
from marketer.rails.http import rails_request_context, to_http
from marketer.story import service
from marketer.story.models import Scene, StorySummary, StoryView

from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

router = APIRouter(dependencies=[Depends(rails_request_context)])


class StoryCreate(BaseModel):
    mode: Literal["idea", "script"] = "idea"
    source: str = Field(min_length=3, max_length=20_000)
    requirement: str = Field(default="", max_length=1000)
    style: str = Field(default="", max_length=500)
    aspect: Literal["9:16", "16:9", "1:1"] = "9:16"
    title: str = Field(default="", max_length=200)
    niche_id: UUID | None = None


class ScriptEdit(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    scenes: list[Scene] = Field(min_length=1, max_length=12)


class ReviseBody(BaseModel):
    note: str = Field(min_length=2, max_length=2000)


class RegenerateBody(BaseModel):
    first_frame: str | None = Field(default=None, max_length=2000)
    motion: str | None = Field(default=None, max_length=1000)


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, service.StoryError):
        return HTTPException(exc.status, exc.detail)
    if isinstance(exc, (RailsDenied, OutcomeUnknown)):
        return to_http(exc)
    raise exc


async def _load(story_id: UUID, ctx: AuthCtx):
    try:
        return await service.load(story_id, ctx.user_id)
    except service.StoryError as exc:
        raise _http(exc) from exc


async def _do(coro) -> StoryView:
    try:
        story = await coro
    except (service.StoryError, RailsDenied, OutcomeUnknown) as exc:
        raise _http(exc) from exc
    return await service.view(story)


_SPAWN_LIMIT = user_rate_limit("stories.spawn", "20/minute")


@router.get("", response_model=list[StorySummary])
async def list_stories(ctx: AuthCtx = CurrentUser, limit: int = Query(default=50, ge=1, le=200)) -> list[StorySummary]:
    return [service.summary(s) for s in await service.get_store().list(ctx.user_id, limit=limit)]


@router.post("", response_model=StoryView, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def create_story(body: StoryCreate, ctx: AuthCtx = CurrentUser) -> StoryView:
    if body.niche_id is not None:
        from marketer.repos import niches as niches_repo

        if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "playbook not found")
    return await _do(service.create(
        user_id=ctx.user_id, actor_id=ctx.actor_id or ctx.user_id, mode=body.mode, source=body.source,
        requirement=body.requirement, style=body.style, aspect=body.aspect, title=body.title, niche_id=body.niche_id,
    ))


@router.get("/{story_id}", response_model=StoryView)
async def get_story(story_id: UUID, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await service.view(await _load(story_id, ctx))


@router.put("/{story_id}/script", response_model=StoryView)
async def edit_script(story_id: UUID, body: ScriptEdit, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.edit_script(await _load(story_id, ctx), scenes=body.scenes, title=body.title))


@router.post("/{story_id}/script/revise", response_model=StoryView, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def revise_script(story_id: UUID, body: ReviseBody, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.revise(await _load(story_id, ctx), body.note))


@router.post("/{story_id}/storyboard", response_model=StoryView, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def make_storyboard(story_id: UUID, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.storyboard(await _load(story_id, ctx)))


@router.post("/{story_id}/shots/{idx}/regenerate", response_model=StoryView, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def regenerate_shot(story_id: UUID, idx: int, body: RegenerateBody, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.regenerate_shot(await _load(story_id, ctx), idx, first_frame=body.first_frame, motion=body.motion))


@router.post("/{story_id}/render", response_model=StoryView, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def render(story_id: UUID, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.request_render(await _load(story_id, ctx)))


@router.post("/{story_id}/render/approve", response_model=StoryView, status_code=status.HTTP_202_ACCEPTED)
async def approve_render(story_id: UUID, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.approve_render(await _load(story_id, ctx), ctx=ctx))


@router.post("/{story_id}/render/decline", response_model=StoryView)
async def decline_render(story_id: UUID, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.decline_render(await _load(story_id, ctx)))


@router.post("/{story_id}/retry", response_model=StoryView, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SPAWN_LIMIT])
async def retry_story(story_id: UUID, ctx: AuthCtx = CurrentUser) -> StoryView:
    return await _do(service.retry(await _load(story_id, ctx)))


async def _file(story_id: UUID, ctx: AuthCtx, kind: str, idx: int | None, media_type: str) -> FileResponse:
    path = await service.file_for(await _load(story_id, ctx), kind, idx)
    if not path or not os.path.exists(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return FileResponse(path, media_type=media_type, headers={"cache-control": "private, max-age=300"})


@router.get("/{story_id}/shots/{idx}/frame")
async def shot_frame(story_id: UUID, idx: int, ctx: AuthCtx = CurrentUser) -> FileResponse:
    return await _file(story_id, ctx, "frame", idx, "image/png")


@router.get("/{story_id}/characters/{idx}/portrait")
async def character_portrait(story_id: UUID, idx: int, ctx: AuthCtx = CurrentUser) -> FileResponse:
    return await _file(story_id, ctx, "portrait", idx, "image/png")


@router.get("/{story_id}/video")
async def story_video(story_id: UUID, ctx: AuthCtx = CurrentUser) -> FileResponse:
    return await _file(story_id, ctx, "video", None, "video/mp4")
