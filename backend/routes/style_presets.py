"""Style presets: curated visual styles with optional reference videos."""
from __future__ import annotations

from fastapi import APIRouter, Request

from marketer.style_presets import PRESETS, StylePreset

from ..auth import AuthCtx, CurrentUser
from ..rate_limit import limiter

router = APIRouter()
_READ_LIMIT = "30/minute"


@router.get("", response_model=list[StylePreset])
@limiter.limit(_READ_LIMIT)
async def list_style_presets(
    request: Request, ctx: AuthCtx = CurrentUser
) -> list[StylePreset]:
    return PRESETS
