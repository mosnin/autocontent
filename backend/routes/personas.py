"""Brand persona endpoints — the voice asset and its chat surface.

CRUD on the persona, a write-once visual reference, and a metered
conversation. Everything is scoped to the authenticated user; a persona
id alone never grants access to anything.

The persona is not a second brand kit. ``/api/v1/brand-kit`` still owns
the account's identity (name, tone, banned words, hashtags, color); a
persona layers a *speaker* on top of it and the chat prompt renders the
kit first. Editing tone in one place still changes every persona.
"""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from marketer.personas import chat as persona_chat
from marketer.personas import visual as persona_visual
from marketer.personas.schemas import (
    MAX_MESSAGE_CHARS,
    Persona,
    PersonaCreate,
    PersonaMessage,
    PersonaTurn,
    PersonaUpdate,
)
from marketer.repos import brand_kit as brand_kit_repo
from marketer.repos import personas as repo

from ..auth import AuthCtx, CurrentUser
from ..rate_limit import limiter

router = APIRouter()


class MessageCreate(BaseModel):
    """POST /personas/{id}/messages body.

    The length bound is enforced here as well as in ``chat.generate_turn``
    so an over-long message is a 422 (free) rather than a truncated,
    already-paid-for turn.
    """

    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


async def _load(persona_id: UUID, user_id: str) -> Persona:
    persona = await repo.get(persona_id, user_id=user_id)
    if persona is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "persona not found")
    return persona


async def _spend_for(persona: Persona, user_id: str):
    """Spend context for a persona-driven provider call.

    When the persona is linked to a niche the call is attributed to it and
    honors that niche's daily cap. Unlinked personas still pass through
    the user's global daily cap and prepaid-credit gate — there is no path
    here that spends money outside the ledger.
    """
    from marketer.repos import niches as niches_repo
    from marketer.services.spend_context import default_context

    cap = None
    if persona.niche_id is not None:
        niche = await niches_repo.get(persona.niche_id, user_id=user_id)
        cap = niche.daily_spend_cap_usd if niche else None
    return await default_context(
        user_id=user_id, niche_id=persona.niche_id, job_id=None, cap_usd=cap
    )


def _spend_error(exc: Exception) -> HTTPException:
    from marketer.repos.spend import SpendCapExceeded

    if isinstance(exc, SpendCapExceeded):
        return HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc))
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "persona generation failed")


# ── Persona CRUD ───────────────────────────────────────────────────────


@router.post("", response_model=Persona, status_code=status.HTTP_201_CREATED)
async def create_persona(body: PersonaCreate, ctx: AuthCtx = CurrentUser) -> Persona:
    if body.niche_id is not None:
        from marketer.repos import niches as niches_repo

        if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "niche not found")
    return await repo.create(
        user_id=ctx.user_id,
        name=body.name.strip(),
        tagline=body.tagline.strip(),
        persona=body.persona.strip(),
        greeting=body.greeting.strip(),
        voice_rules=body.voice_rules.strip(),
        banned_topics=body.banned_topics,
        niche_id=body.niche_id,
    )


@router.get("", response_model=list[Persona])
async def list_personas(
    ctx: AuthCtx = CurrentUser,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[Persona]:
    return await repo.list_for_user(ctx.user_id, limit=limit)


@router.get("/{persona_id}", response_model=Persona)
async def get_persona(persona_id: UUID, ctx: AuthCtx = CurrentUser) -> Persona:
    return await _load(persona_id, ctx.user_id)


@router.put("/{persona_id}", response_model=Persona)
async def update_persona(
    persona_id: UUID, body: PersonaUpdate, ctx: AuthCtx = CurrentUser
) -> Persona:
    # exclude_unset so an omitted key keeps its value instead of being
    # blanked (same contract as PUT /niches/{id}).
    fields = body.model_dump(exclude_unset=True)
    if fields.get("niche_id") is not None:
        from marketer.repos import niches as niches_repo

        if await niches_repo.get(fields["niche_id"], user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "niche not found")
    persona = await repo.update(persona_id, user_id=ctx.user_id, **fields)
    if persona is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "persona not found")
    return persona


@router.delete("/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_persona(persona_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    await repo.delete(persona_id, user_id=ctx.user_id)


# ── Visual reference (write-once) ──────────────────────────────────────


@router.post("/{persona_id}/visual", response_model=Persona,
             status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("6/minute")
async def lock_persona_visual(
    request: Request, persona_id: UUID, ctx: AuthCtx = CurrentUser
) -> Persona:
    """Generate and lock the persona's visual reference.

    One metered image call through the existing character-sheet service.
    Locking is write-once: a second call gets 409 rather than quietly
    redrawing a face that published creative already depends on.
    """
    persona = await _load(persona_id, ctx.user_id)
    if persona.visual_locked_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "persona visual reference is already locked"
        )

    kit = await brand_kit_repo.get(ctx.user_id)
    spend = await _spend_for(persona, ctx.user_id)
    try:
        path = await persona_visual.lock_reference(persona, kit=kit, spend=spend)
    except persona_visual.VisualAlreadyLocked as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — mapped to a clean 402/502
        raise _spend_error(exc) from exc

    locked = await repo.lock_visual(persona_id, user_id=ctx.user_id, path=path)
    if locked is None:
        # A concurrent request won the write-once race; the image already
        # exists, so just return the current state rather than erroring.
        return await _load(persona_id, ctx.user_id)
    return locked


@router.get("/{persona_id}/visual")
async def get_persona_visual(
    persona_id: UUID, ctx: AuthCtx = CurrentUser
) -> FileResponse:
    """Stream the locked reference image. Ownership-scoped: the lookup is
    by (id, user_id), so a foreign id is a 404, not someone else's face."""
    persona = await _load(persona_id, ctx.user_id)
    path = persona.visual_ref_path or str(persona_visual.reference_path(persona_id))
    if not persona.visual_ref_path or not os.path.exists(path):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "persona has no locked visual reference yet"
        )
    return FileResponse(path, media_type="image/png")


# ── Conversation ───────────────────────────────────────────────────────


@router.get("/{persona_id}/messages", response_model=list[PersonaMessage])
async def list_persona_messages(
    persona_id: UUID,
    ctx: AuthCtx = CurrentUser,
    limit: int = Query(default=50, ge=1, le=repo.MAX_LIST_MESSAGES),
) -> list[PersonaMessage]:
    """The conversation, oldest first (newest ``limit`` turns).

    An empty conversation renders the persona's greeting as a synthetic
    opening message. It is deliberately NOT written to the table: a GET
    must not mutate, and the greeting is derived from the persona (edit
    the greeting and the empty thread updates with it) rather than being
    a frozen turn.
    """
    persona = await _load(persona_id, ctx.user_id)
    messages = await repo.list_messages(persona_id, user_id=ctx.user_id, limit=limit)
    if not messages and persona.greeting:
        return [
            PersonaMessage(
                id=persona.id,
                persona_id=persona.id,
                user_id=ctx.user_id,
                role="assistant",
                content=persona.greeting,
                created_at=persona.created_at,
            )
        ]
    return messages


@router.post("/{persona_id}/messages", response_model=PersonaTurn)
@limiter.limit("30/minute")
async def post_persona_message(
    request: Request,
    persona_id: UUID,
    body: MessageCreate,
    ctx: AuthCtx = CurrentUser,
) -> PersonaTurn:
    """One metered chat turn.

    Spend is bounded four ways: the per-IP rate limit above, the caps
    evaluated by ``ensure_can_spend`` before the provider is touched, the
    windowed history that keeps input cost flat as the thread grows, and
    the per-turn output-token ceiling in ``personas.chat``. Both rows are
    persisted only after the reply lands, so a cap refusal (402) leaves
    the thread exactly as it was.
    """
    persona = await _load(persona_id, ctx.user_id)
    kit = await brand_kit_repo.get(ctx.user_id)
    history = await repo.list_messages(
        persona_id, user_id=ctx.user_id, limit=persona_chat.MAX_HISTORY_MESSAGES
    )
    spend = await _spend_for(persona, ctx.user_id)
    try:
        reply = await persona_chat.generate_turn(
            persona=persona,
            user_content=body.content,
            history=history,
            kit=kit,
            spend=spend,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — mapped to a clean 402/502
        raise _spend_error(exc) from exc

    return await repo.append_turn(
        persona_id,
        user_id=ctx.user_id,
        user_content=body.content,
        assistant_content=reply,
    )


@router.delete("/{persona_id}/messages", status_code=status.HTTP_204_NO_CONTENT)
async def clear_persona_messages(persona_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    """Clear the conversation. The persona (the asset) survives."""
    await _load(persona_id, ctx.user_id)
    await repo.clear_messages(persona_id, user_id=ctx.user_id)
