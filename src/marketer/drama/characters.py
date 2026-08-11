"""Casting stage: extract the recurring cast, then LOCK one portrait each.

Character consistency is the distinguishing feature of this product versus
the stock video pipeline, and it rests on one invariant:

    **A character's reference portrait is generated exactly once and never
    regenerated for the life of the drama.**

Every shot that character appears in is generated as an *edit* of that same
portrait, so the same face/build/wardrobe comes back shot after shot. If a
retry re-generated the portrait, gpt-image-1 would return a different person
and every subsequent shot would silently re-cast mid-film — worse than
failing, because it looks like a working render. So the lock is enforced by
the file on the volume: a portrait that already exists is adopted, never
re-bought (which also makes the expensive part of a resume free).

Portraits themselves are generated against the niche's character/style sheet
(`services.character_sheet`) so a drama's cast inherits the niche's art
direction instead of inventing its own look.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from agents import Agent

from ..agents.metered import run_metered
from ..config import settings
from ..logging import get_logger
from ..models import Niche
from ..services import openai_images, provider_limits
from ..services.spend_context import SpendContext
from .schemas import MAX_CAST, CastDraft, Character, cast_from_draft

log = get_logger(__name__)


class DramaConfigError(RuntimeError):
    """A required provider key is absent. Raised BEFORE any spend."""


CHARACTER_EXTRACTOR_INSTRUCTIONS = f"""You are a casting director.

Input is JSON: {{"screenplay", "visual_style", "cast_hint", "max_cast"}}.

Extract every RECURRING, VISIBLE character and describe them precisely enough
that an image model can draw the same person twice.

Rules:
- At most `max_cast` characters ({MAX_CAST} hard maximum). If more people
  appear, keep only those who carry the story; background extras are not cast.
- `name`: exactly as written in the screenplay. Do not rename, translate, or
  re-spell — the name is the join key between the screenplay and the portrait.
- `static_features`: what NEVER changes — apparent age, build, height,
  skin tone, face shape, eye and hair colour, hair length and style, and one
  distinctive identifying detail (a scar, a gap tooth, heterochromia). Be
  specific; vague descriptions produce a different person every render.
- `wardrobe`: ONE outfit worn for the whole drama, described concretely
  (fabric, colour, silhouette, accessories). A micro-drama is minutes long —
  the cast does not change clothes.
- `role`: one or two words ("protagonist", "rival", "mother").
- Never include characters who are only mentioned but never seen.
- Never describe text, logos, or writing on clothing.
"""


def build_character_extractor_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="DramaCharacterExtractor",
        instructions=CHARACTER_EXTRACTOR_INSTRUCTIONS,
        output_type=CastDraft,
    )


async def extract_cast(
    screenplay_text: str,
    *,
    niche: Niche,
    max_cast: int = MAX_CAST,
    spend: SpendContext | None = None,
) -> list[Character]:
    """One metered LLM call -> a bounded, de-duplicated cast (no portraits)."""
    payload = {
        "screenplay": screenplay_text,
        "visual_style": niche.visual_style,
        "cast_hint": niche.character_description or "",
        "max_cast": min(max_cast, MAX_CAST),
    }
    result = await run_metered(
        build_character_extractor_agent(),
        json.dumps(payload),
        spend=spend,
        sku=f"llm:{settings.agent_model}:drama_cast",
    )
    return cast_from_draft(
        result.final_output_as(CastDraft), max_cast=min(max_cast, MAX_CAST)
    )


def portrait_path(root: Path, character: Character) -> Path:
    """Deterministic per-character path — the file IS the lock."""
    return root / "cast" / f"{character.id}.png"


def _portrait_prompt(character: Character, *, niche: Niche) -> str:
    parts = [
        f"Character reference portrait of {character.name}.",
        f"{character.static_features}.",
    ]
    if character.wardrobe:
        parts.append(f"Wearing {character.wardrobe}.")
    parts.append(f"Art direction (match exactly): {niche.visual_style}.")
    parts.append(
        "Head-and-shoulders framing, neutral expression, plain uncluttered "
        "background, even soft lighting, full face clearly visible. This is a "
        "canonical casting reference: the face, build, hair, and wardrobe here "
        "are reused in every later shot. No text, no captions, no watermarks."
    )
    return " ".join(parts)


async def _lock_one(
    character: Character,
    *,
    root: Path,
    niche: Niche,
    style_reference: Path | None,
    spend: SpendContext | None,
) -> Character:
    path = portrait_path(root, character)
    if path.exists():
        # Already paid for (first attempt, or an earlier stage of this run).
        # Adopting the file is what makes a portrait "locked" — regenerating
        # would return a different actor for the same character.
        log.info("drama: reusing locked portrait", extra={"character": character.id})
        return character.model_copy(update={"reference_image_path": str(path)})

    async with provider_limits.slot("openai_images"):
        await openai_images.generate_keyframe(
            _portrait_prompt(character, niche=niche),
            path,
            quality=niche.image_quality,
            # The niche sheet seeds the drama's look; without it each cast
            # member would be drawn in a slightly different house style.
            reference_image_path=style_reference,
            spend=spend,
        )
    return character.model_copy(update={"reference_image_path": str(path)})


async def lock_reference_portraits(
    cast: list[Character],
    *,
    root: Path,
    niche: Niche,
    style_reference: Path | None = None,
    spend: SpendContext | None = None,
    fanout_limit: int | None = None,
) -> list[Character]:
    """Ensure every cast member has a locked portrait.

    Idempotent by construction: characters whose portrait file already exists
    cost nothing, so this is safe to call on every attempt. Fan-out is capped
    at `settings.scene_fanout_limit` — an unbounded cast render is a spend and
    rate-limit hazard exactly like the shot fan-out.

    Raises `DramaConfigError` when the image key is absent, BEFORE any spend.
    """
    if not cast:
        return []
    if not settings.openai_api_key:
        raise DramaConfigError(
            "micro-drama casting needs MARKETER_OPENAI_API_KEY for character "
            "reference portraits — configure it before running a drama"
        )
    limit = fanout_limit or settings.scene_fanout_limit
    sem = asyncio.Semaphore(limit)

    async def _bounded(c: Character) -> Character:
        async with sem:
            return await _lock_one(
                c, root=root, niche=niche, style_reference=style_reference, spend=spend
            )

    return list(await asyncio.gather(*[_bounded(c) for c in cast]))
