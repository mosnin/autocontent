"""Per-niche character/style sheet.

First time a niche generates a video we render a stand-alone reference
image that establishes the cast, color palette, and rendering style.
Every subsequent scene generation passes the sheet as a reference image
to gpt-image-1 so characters stay on-model across jobs.

Stored on the persistent assets volume so it survives between jobs:
    /assets/character_sheets/<niche_id>.png
"""
from __future__ import annotations

from pathlib import Path
from uuid import UUID

from ..config import settings
from ..models import Niche
from . import openai_images
from .spend_context import SpendContext


def sheet_path(niche_id: UUID) -> Path:
    return Path(settings.assets_dir) / "character_sheets" / f"{niche_id}.png"


def _build_sheet_prompt(niche: Niche) -> str:
    return (
        f"Character and style reference sheet for a short-form video series "
        f"about: {niche.title}. {niche.description}\n\n"
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
    if path.exists():
        return path
    return await openai_images.generate_reference(
        _build_sheet_prompt(niche),
        path,
        quality=quality,
        spend=spend,
    )
