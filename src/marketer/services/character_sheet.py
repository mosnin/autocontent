"""Per-niche character/style sheet.

First time a niche generates a video we render a stand-alone reference
image that establishes the cast, color palette, and rendering style.
Every subsequent scene generation passes the sheet as a reference image
to gpt-image-1 so characters stay on-model across jobs.

When the niche defines `character_description` the sheet renders *that*
cast verbatim instead of letting the model invent one — this is how
user-supplied custom characters flow into every keyframe.

The sheet is cached with a fingerprint sidecar of the inputs that shaped
it (visual style + character description); editing either regenerates the
sheet on the next job instead of serving the stale look forever.

Stored on the persistent assets volume so it survives between jobs:
    /assets/character_sheets/<niche_id>.png (+ .fingerprint)
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import UUID

from ..config import settings
from ..logging import get_logger
from ..models import Niche
from . import openai_images
from .spend_context import SpendContext

log = get_logger(__name__)


def sheet_path(niche_id: UUID) -> Path:
    return Path(settings.assets_dir) / "character_sheets" / f"{niche_id}.png"


def _fingerprint_path(niche_id: UUID) -> Path:
    return sheet_path(niche_id).with_suffix(".fingerprint")


def _fingerprint(niche: Niche) -> str:
    material = "\x1f".join([
        niche.visual_style,
        niche.character_description or "",
    ])
    return hashlib.sha256(material.encode()).hexdigest()


def _build_sheet_prompt(niche: Niche) -> str:
    if niche.character_description:
        cast = (
            f"The recurring cast is defined by the creator and must be "
            f"rendered exactly as described: {niche.character_description}\n\n"
        )
    else:
        cast = ""
    return (
        f"Character and style reference sheet for a short-form video series "
        f"about: {niche.title}. {niche.description}\n\n"
        f"{cast}"
        f"Visual style (apply verbatim to every future scene): {niche.visual_style}\n\n"
        f"Compose a single 9:16 image showing the recurring character(s) in a "
        f"neutral pose against a clean background, plus a small color-palette "
        f"strip along the bottom. The character design here is canonical: "
        f"clothing, hair, build, proportions, and palette must be reusable as a "
        f"reference for later scenes."
    )


async def get_or_create(
    niche: Niche,
    *,
    quality: str = "medium",
    spend: SpendContext | None = None,
) -> Path:
    path = sheet_path(niche.id)
    fp_path = _fingerprint_path(niche.id)
    current_fp = _fingerprint(niche)

    if path.exists():
        if not fp_path.exists():
            # Legacy sheet from before fingerprinting: adopt it as the
            # canonical look for the *current* style so the next style
            # edit triggers regeneration.
            fp_path.write_text(current_fp)
            return path
        if fp_path.read_text().strip() == current_fp:
            return path
        log.info(
            "character sheet stale (style/cast edited); regenerating",
            extra={"niche_id": str(niche.id)},
        )

    result = await openai_images.generate_reference(
        _build_sheet_prompt(niche),
        path,
        quality=quality,
        spend=spend,
    )
    fp_path.parent.mkdir(parents=True, exist_ok=True)
    fp_path.write_text(current_fp)
    return result
