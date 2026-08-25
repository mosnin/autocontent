"""Lock a persona's visual reference — reusing the niche character sheet.

We do **not** ship a second reference-sheet generator. The existing
``services.character_sheet.get_or_create`` already renders a canonical
9:16 reference (cast + palette strip) from four attributes and caches it
on the assets volume keyed by UUID. This module adapts a Persona onto
that same shape and calls it, so a persona's face is produced by exactly
the code path that keeps niche keyframes on-model.

Why the reference is locked once
--------------------------------
A niche sheet is *fingerprinted*: edit the visual style and the next job
regenerates it. That is right for a niche, whose look is a setting.
It is wrong for a persona, whose look is an **identity** — once the
persona has appeared in published creative, silently redrawing its face
because someone tweaked a sentence of backstory would desynchronize every
asset already in the wild from every asset made after. So the first
successful generation stamps ``visual_locked_at`` and from then on this
module returns the existing file and never regenerates. Re-locking is a
deliberate act: delete the reference (or the persona) to start over.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from ..repos.brand_kit import BrandKit
from ..services import character_sheet
from ..services.spend_context import SpendContext
from .prompt import as_data
from .schemas import (
    MAX_NAME_CHARS,
    MAX_PERSONA_CHARS,
    MAX_TAGLINE_CHARS,
    Persona,
)


class VisualAlreadyLocked(Exception):
    """Raised when a lock is requested for a persona that already has one."""


@dataclass
class _SheetSubject:
    """Structural adapter onto what ``character_sheet`` reads off a Niche.

    ``get_or_create`` only touches ``id``, ``title``, ``description``,
    ``visual_style`` and ``character_description``; supplying those is
    enough and avoids fabricating a whole Niche (scene counts, posting
    windows, spend caps) that would be meaningless for a persona.

    NOTE for the lead: ``character_sheet.get_or_create`` is annotated
    ``niche: Niche``. Widening that annotation to a Protocol with these
    five attributes would make this reuse explicit instead of structural.
    """

    id: UUID
    title: str
    description: str
    visual_style: str
    character_description: str | None


def reference_path(persona_id: UUID) -> Path:
    """Where the persona's locked reference lives. Same directory scheme
    as niche sheets — keys are UUIDs, so the namespaces cannot collide."""
    return character_sheet.sheet_path(persona_id)


def build_subject(persona: Persona, kit: BrandKit | None = None) -> _SheetSubject:
    """Map the persona (and the brand kit's art direction) onto the sheet
    inputs. Every interpolated value is sanitized: this text ends up in an
    image prompt, which is another instruction channel, so the same
    data-not-instructions discipline applies as in the chat prompt."""
    name = as_data(persona.name, MAX_NAME_CHARS) or "Brand persona"
    tagline = as_data(persona.tagline, MAX_TAGLINE_CHARS)
    body = as_data(persona.persona, MAX_PERSONA_CHARS)

    style_bits: list[str] = []
    if kit is not None:
        if kit.tone_of_voice:
            style_bits.append(f"brand mood: {as_data(kit.tone_of_voice, 300)}")
        if kit.color_hex:
            # The kit already owns the accent color; the sheet inherits it
            # rather than inventing a second palette source of truth.
            style_bits.append(f"accent color {kit.color_hex}")
    style_bits.append(
        "clean modern brand portrait, consistent lighting, neutral backdrop, "
        "suitable as a canonical reference for future creative"
    )

    return _SheetSubject(
        id=persona.id,
        title=name,
        description=tagline or f"Brand persona {name}",
        visual_style=", ".join(style_bits),
        # The persona brief IS the cast description — this is what makes
        # the sheet render *this* persona instead of an invented one.
        character_description=body or None,
    )


async def lock_reference(
    persona: Persona,
    *,
    kit: BrandKit | None = None,
    quality: str = "medium",
    spend: SpendContext | None = None,
    force: bool = False,
) -> Path:
    """Generate (once) and return the persona's locked visual reference.

    Idempotent by design: if the persona is already locked and the file is
    on the volume, no provider call is made and no money is spent. Pass
    ``force=True`` only from a deliberate re-lock path.
    """
    path = reference_path(persona.id)
    if not force and persona.visual_locked_at is not None and path.exists():
        raise VisualAlreadyLocked(
            "persona visual reference is locked; delete it before regenerating"
        )
    if not force and path.exists():
        # File on disk but no lock recorded (interrupted lock, restored
        # volume): adopt it rather than paying to draw it again.
        return path

    subject = build_subject(persona, kit)
    return await character_sheet.get_or_create(subject, quality=quality, spend=spend)
