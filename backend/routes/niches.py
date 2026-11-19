from __future__ import annotations

import logging
import re
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from marketer import rails
from marketer.models import CreativeBrief, Niche, PostingWindow
from marketer.rails.http import rails_request_context, to_http
from marketer.repos import niches as niches_repo
from marketer.services.character_sheet import sheet_path

from ..auth import AuthCtx, CurrentUser
from ..policy import require_permission
from ..security import user_rate_limit

# update_niche dispatches through marketer.rails when it changes the spend cap
# or the approval gate; the dependency hands it the request's idempotency-key
# (docs/rails/enforcement-point.md).
router = APIRouter(dependencies=[Depends(rails_request_context)])

# Bounds on what a playbook may hold. The body-size middleware stops a huge
# request; these stop a small request from configuring a huge (expensive) run
# or overflowing a column (daily_spend_cap_usd is numeric(8,2)).
MAX_DAILY_SPEND_CAP_USD = Decimal("100000")


def _check_hashtags(v: list[str] | None) -> list[str] | None:
    if v is None:
        return v
    if len(v) > 50:
        raise ValueError("at most 50 hashtags")
    if any(len(t) > 100 for t in v):
        raise ValueError("a hashtag is at most 100 characters")
    return v

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
    description: str = Field(max_length=4000)


# An unmetered model call (no playbook exists yet to charge), so it is the
# one LLM endpoint with no spend cap behind it: bound it per account.
@router.post("/draft", dependencies=[user_rate_limit("niches.draft", "10/minute")])
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
        # The provider's message can carry request ids, model names and
        # prompt fragments: log it, do not hand it to the client.
        logging.getLogger(__name__).warning("niche draft failed", exc_info=True)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="could not draft a channel right now; try again",
        ) from e
    return draft.model_dump()


class NicheCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(max_length=8000)
    target_audience: str = Field(max_length=2000)
    hashtags: list[str]
    visual_style: str = Field(max_length=4000)
    voice: str = Field(max_length=1000)
    target_duration_sec: int = Field(ge=1, le=600)
    scene_count: int = Field(ge=1, le=60)
    posting_windows: list[PostingWindow] = Field(max_length=48)
    platforms: list[Literal["tiktok", "reels", "shorts"]] = Field(max_length=3)
    # Strictly positive: a zero/negative cap would trip the spend guard on
    # the very first metered call, failing every run for the niche.
    daily_spend_cap_usd: Decimal = Field(gt=0, le=MAX_DAILY_SPEND_CAP_USD)
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = Field(default=5, ge=1, le=15)
    tts_style_directions: str | None = Field(default=None, max_length=2000)
    approve_before_post: bool = False
    character_description: str | None = Field(default=None, max_length=4000)
    creative_brief: CreativeBrief | None = None
    video_provider: Literal["grok", "fal"] = "grok"
    fal_model: str = Field(default="", max_length=200)
    script_model: str = Field(default="", max_length=200)
    voice_provider: Literal["openai", "elevenlabs"] = "openai"
    elevenlabs_voice_id: str = ""
    music_provider: Literal["auto", "library", "generated"] = "auto"
    design_kit_id: UUID | None = None
    writing_kit_id: UUID | None = None

    @field_validator("elevenlabs_voice_id")
    @classmethod
    def _validate_elevenlabs_voice_id(cls, v: str) -> str:
        return _check_voice_id(v) or ""

    @field_validator("hashtags")
    @classmethod
    def _validate_hashtags(cls, v: list[str]) -> list[str]:
        return _check_hashtags(v) or []


class NicheUpdate(BaseModel):
    """All fields optional — partial update.

    Mirrors :class:`NicheCreate` so the web client can POST the same
    payload to either endpoint and the backend interprets unset keys
    as "leave alone".
    """

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    target_audience: str | None = Field(default=None, max_length=2000)
    hashtags: list[str] | None = None
    visual_style: str | None = Field(default=None, max_length=4000)
    voice: str | None = Field(default=None, max_length=1000)
    target_duration_sec: int | None = Field(default=None, ge=1, le=600)
    scene_count: int | None = Field(default=None, ge=1, le=60)
    posting_windows: list[PostingWindow] | None = Field(default=None, max_length=48)
    platforms: list[Literal["tiktok", "reels", "shorts"]] | None = Field(default=None, max_length=3)
    daily_spend_cap_usd: Decimal | None = Field(default=None, gt=0, le=MAX_DAILY_SPEND_CAP_USD)
    image_quality: Literal["low", "medium", "high"] | None = None
    video_resolution: Literal["480p", "720p"] | None = None
    scene_max_duration_sec: int | None = Field(default=None, ge=1, le=15)
    tts_style_directions: str | None = Field(default=None, max_length=2000)
    approve_before_post: bool | None = None
    character_description: str | None = Field(default=None, max_length=4000)
    creative_brief: CreativeBrief | None = None
    video_provider: Literal["grok", "fal"] | None = None
    fal_model: str | None = Field(default=None, max_length=200)
    script_model: str | None = Field(default=None, max_length=200)
    voice_provider: Literal["openai", "elevenlabs"] | None = None
    elevenlabs_voice_id: str | None = None
    music_provider: Literal["auto", "library", "generated"] | None = None
    design_kit_id: UUID | None = None
    writing_kit_id: UUID | None = None

    @field_validator("elevenlabs_voice_id")
    @classmethod
    def _validate_elevenlabs_voice_id(cls, v: str | None) -> str | None:
        return _check_voice_id(v)

    @field_validator("hashtags")
    @classmethod
    def _validate_hashtags(cls, v: list[str] | None) -> list[str] | None:
        return _check_hashtags(v)


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


def _limit_changes(current: Niche, fields: dict) -> list[tuple[str, dict]]:
    """The HIGH actions this update amounts to, judged against the playbook as
    it is now (not as the caller believes it is). Empty when the update leaves
    the spend cap and the approval gate alone."""
    changes: list[tuple[str, dict]] = []
    new_cap = fields.get("daily_spend_cap_usd")
    if new_cap is not None and new_cap != current.daily_spend_cap_usd:
        action = (
            "playbook.spend_cap.raise"
            if new_cap > current.daily_spend_cap_usd
            else "playbook.spend_cap.lower"
        )
        changes.append((action, {
            "niche_id": current.id,
            "daily_spend_cap_usd": new_cap,
            "previous_daily_spend_cap_usd": current.daily_spend_cap_usd,
        }))
    gate = fields.get("approve_before_post")
    if gate is not None and gate != current.approve_before_post:
        action = "playbook.approval.enable" if gate else "playbook.approval.disable"
        changes.append((action, {"niche_id": current.id, "approve_before_post": gate}))
    return changes


@router.put("/{niche_id}", response_model=Niche)
async def update_niche(
    niche_id: UUID,
    body: NicheUpdate,
    ctx: AuthCtx = CurrentUser,
) -> Niche:
    """Partial update. Fields left unset are not touched.

    Changing the daily spend cap or the approval gate is a HIGH action and
    goes through the enforcement point (docs/rails/enforcement-point.md): a
    kill switch stops a raise or the removal of the gate, never a tightening;
    the agent's idempotency key dedupes a replay; the change is recorded.
    The agent may never remove the approval gate, whatever was approved."""
    # exclude_unset so omitted JSON keys (vs. explicit nulls) don't
    # clobber existing values.
    fields = body.model_dump(exclude_unset=True)
    await _validate_kit_refs(
        ctx.user_id, fields.get("design_kit_id"), fields.get("writing_kit_id")
    )
    if "voice_provider" in fields:
        _validate_voice_provider(fields["voice_provider"])

    dispatches: list[rails.Dispatch] = []
    if fields.get("daily_spend_cap_usd") is not None or fields.get("approve_before_post") is not None:
        current = await niches_repo.get(niche_id, user_id=ctx.user_id)
        if current is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        changes = _limit_changes(current, fields)
        # backend/policy.py: InRoute. Caps need spend:set_limits; the approval
        # gate needs content:approve (whoever waives approval must hold it).
        if any(a.startswith("playbook.spend_cap.") for a, _ in changes):
            await require_permission(ctx, "spend:set_limits")
        if any(a.startswith("playbook.approval.") for a, _ in changes):
            await require_permission(ctx, "content:approve")
        if ctx.delegated and any(a == "playbook.approval.disable" for a, _ in changes):
            # Content made by agents waits for a person. Only that person can
            # take the gate away (fail closed, ADR 0002: tighten, never loosen).
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "only a person can turn off approval before posting",
            )
        try:
            for action, args in changes:
                dispatches.append(await rails.enforce_dispatch(
                    action, user_id=ctx.user_id, principal=rails.principal_of(ctx),
                    actor_email=ctx.email, args=args,
                    target_type="niche", target_id=str(niche_id),
                ))
        except rails.RailsDenied as e:
            for d in dispatches:
                await d.failed(f"not applied: {e.code}")
            raise to_http(e) from e

    try:
        n = await niches_repo.update(niche_id, user_id=ctx.user_id, **fields)
    except Exception as e:
        for d in dispatches:
            await d.failed(f"{type(e).__name__}: {e}")
        raise
    if n is None:
        for d in dispatches:
            await d.failed("niche not found")
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    for d in dispatches:
        await d.succeeded()
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
