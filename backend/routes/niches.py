from __future__ import annotations

import re
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from marketer.models import CreativeBrief, Niche, PostingWindow
from marketer.repos import niches as niches_repo
from marketer.services.character_sheet import sheet_path

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

# ElevenLabs voice ids are short alphanumeric tokens (e.g.
# "21m00Tcm4TlvDq8ikWAM"). This value is interpolated directly into a
# request URL *path* by elevenlabs_tts.synthesize
# (f"{API_BASE}/text-to-speech/{voice_id}"), so anything else — path
# separators, whitespace, percent-encoding, full URLs — is a path
# traversal / request-redirection vector. Reject it here at the only
# point untrusted input enters the field; empty string is allowed and
# means "use the deploy default".
_VOICE_ID_RE = re.compile(r"^[A-Za-z0-9]{1,40}$")


def _check_voice_id(v: str | None) -> str | None:
    if v is None or v == "":
        return v
    if not _VOICE_ID_RE.match(v):
        raise ValueError(
            "elevenlabs_voice_id must be empty or 1-40 alphanumeric characters"
        )
    return v


class DraftRequest(BaseModel):
    description: str


@router.post("/draft")
async def draft_niche_spec(
    body: DraftRequest, ctx: AuthCtx = CurrentUser
) -> dict:
    """One sentence in, a full channel spec out. The onboarding front
    door: the client shows the returned fields on a review screen so the
    user launches instead of filling a 16-field form."""
    from marketer.agents.niche_draft import draft_niche
    from marketer.repos import brand_kit as brand_kit_repo

    text = body.description.strip()
    if len(text) < 8:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="describe your channel in a sentence (at least a few words)",
        )
    # Steer the draft with the user's brand kit when they have one.
    kit = await brand_kit_repo.get(ctx.user_id)
    brand_context = brand_kit_repo.as_prompt_context(kit)
    try:
        draft = await draft_niche(text, brand_context=brand_context)
    except Exception as e:  # noqa: BLE001 — surface as a clean 502
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"could not draft a channel: {e}",
        ) from e
    return draft.model_dump()


class NicheCreate(BaseModel):
    title: str
    description: str
    target_audience: str
    hashtags: list[str]
    visual_style: str
    voice: str
    target_duration_sec: int
    scene_count: int
    posting_windows: list[PostingWindow]
    platforms: list[Literal["tiktok", "reels", "shorts"]]
    # Strictly positive: a zero/negative cap would trip the spend guard on
    # the very first metered call, failing every run for the niche.
    daily_spend_cap_usd: Decimal = Field(gt=0)
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = 5
    tts_style_directions: str | None = None
    approve_before_post: bool = False
    character_description: str | None = None
    creative_brief: CreativeBrief | None = None
    video_provider: Literal["grok", "fal"] = "grok"
    fal_model: str = ""
    script_model: str = ""
    voice_provider: Literal["openai", "elevenlabs"] = "openai"
    elevenlabs_voice_id: str = ""
    music_provider: Literal["auto", "library", "generated"] = "auto"
    design_kit_id: UUID | None = None
    writing_kit_id: UUID | None = None

    @field_validator("elevenlabs_voice_id")
    @classmethod
    def _validate_elevenlabs_voice_id(cls, v: str) -> str:
        return _check_voice_id(v) or ""


class NicheUpdate(BaseModel):
    """All fields optional — partial update.

    Mirrors :class:`NicheCreate` so the web client can POST the same
    payload to either endpoint and the backend interprets unset keys
    as "leave alone".
    """

    title: str | None = None
    description: str | None = None
    target_audience: str | None = None
    hashtags: list[str] | None = None
    visual_style: str | None = None
    voice: str | None = None
    target_duration_sec: int | None = None
    scene_count: int | None = None
    posting_windows: list[PostingWindow] | None = None
    platforms: list[Literal["tiktok", "reels", "shorts"]] | None = None
    daily_spend_cap_usd: Decimal | None = Field(default=None, gt=0)
    image_quality: Literal["low", "medium", "high"] | None = None
    video_resolution: Literal["480p", "720p"] | None = None
    scene_max_duration_sec: int | None = None
    tts_style_directions: str | None = None
    approve_before_post: bool | None = None
    character_description: str | None = None
    creative_brief: CreativeBrief | None = None
    video_provider: Literal["grok", "fal"] | None = None
    fal_model: str | None = None
    script_model: str | None = None
    voice_provider: Literal["openai", "elevenlabs"] | None = None
    elevenlabs_voice_id: str | None = None
    music_provider: Literal["auto", "library", "generated"] | None = None
    design_kit_id: UUID | None = None
    writing_kit_id: UUID | None = None

    @field_validator("elevenlabs_voice_id")
    @classmethod
    def _validate_elevenlabs_voice_id(cls, v: str | None) -> str | None:
        return _check_voice_id(v)


@router.get("", response_model=list[Niche])
async def list_niches(ctx: AuthCtx = CurrentUser) -> list[Niche]:
    return await niches_repo.list_for_user(ctx.user_id)


def _validate_voice_provider(voice_provider: str | None) -> None:
    """Reject configuring a voice engine that will fail every job.

    Mirrors _validate_kit_refs: better a loud 422 at save time than a
    silent per-job failure once the pipeline actually calls
    elevenlabs_tts.synthesize with no key configured."""
    if voice_provider != "elevenlabs":
        return
    from marketer.services import elevenlabs_tts

    if not elevenlabs_tts.enabled():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "voice_provider 'elevenlabs' is not available on this "
                "deploy — ELEVENLABS_API_KEY is not configured"
            ),
        )


async def _validate_kit_refs(
    user_id: str, design_kit_id, writing_kit_id
) -> None:
    """Reject wrong-kind or foreign kit ids loudly — resolve() would
    otherwise silently substitute the default kit."""
    from marketer.repos import kits as kits_repo

    for kit_id, kind in ((design_kit_id, "design"), (writing_kit_id, "writing")):
        if kit_id is None:
            continue
        kit = await kits_repo.get(kit_id, user_id=user_id)
        if kit is None or kit.kind != kind:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{kind}_kit_id does not reference your {kind} kit",
            )


@router.post("", response_model=Niche, status_code=status.HTTP_201_CREATED)
async def create_niche(body: NicheCreate, ctx: AuthCtx = CurrentUser) -> Niche:
    await _validate_kit_refs(ctx.user_id, body.design_kit_id, body.writing_kit_id)
    _validate_voice_provider(body.voice_provider)
    return await niches_repo.create(ctx.user_id, **body.model_dump())


@router.get("/{niche_id}", response_model=Niche)
async def get_niche(niche_id: UUID, ctx: AuthCtx = CurrentUser) -> Niche:
    n = await niches_repo.get(niche_id, user_id=ctx.user_id)
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return n


@router.put("/{niche_id}", response_model=Niche)
async def update_niche(
    niche_id: UUID,
    body: NicheUpdate,
    ctx: AuthCtx = CurrentUser,
) -> Niche:
    """Partial update. Fields left unset are not touched."""
    # exclude_unset so omitted JSON keys (vs. explicit nulls) don't
    # clobber existing values.
    fields = body.model_dump(exclude_unset=True)
    await _validate_kit_refs(
        ctx.user_id, fields.get("design_kit_id"), fields.get("writing_kit_id")
    )
    if "voice_provider" in fields:
        _validate_voice_provider(fields["voice_provider"])
    n = await niches_repo.update(niche_id, user_id=ctx.user_id, **fields)
    if n is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return n


@router.delete("/{niche_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_niche(niche_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    await niches_repo.archive(niche_id, user_id=ctx.user_id)


@router.get("/{niche_id}/character-sheet")
async def character_sheet_image(
    niche_id: UUID, ctx: AuthCtx = CurrentUser
) -> FileResponse:
    """The niche's generated character sheet — the face of the channel.

    404 until the first pipeline run generates it; the niche detail page
    hides the card in that case."""
    niche = await niches_repo.get(niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")
    path = sheet_path(niche_id)
    if not path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="character sheet not generated yet — run a video first",
        )
    return FileResponse(path, media_type="image/png")
