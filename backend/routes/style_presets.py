"""Style presets: curated visual styles with optional reference videos."""
from __future__ import annotations

from fastapi import APIRouter

from marketer.style_presets import PRESETS, StylePreset

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("", response_model=list[StylePreset])
async def list_style_presets(ctx: AuthCtx = CurrentUser) -> list[StylePreset]:
    return PRESETS
