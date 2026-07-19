"""Provider catalogs for the niche-settings dropdowns.

- GET /api/v1/providers/video-models  — animation backends (Grok + Fal)
- GET /api/v1/providers/script-models — scriptwriter LLMs (stock + OpenRouter)

Each entry carries `available` so the UI can show-but-disable options
whose keys aren't configured on this deploy.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from marketer.config import settings
from marketer.services import fal_video, openrouter

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class VideoModelOption(BaseModel):
    provider: str          # 'grok' | 'fal'
    model_id: str          # '' for grok (single model)
    name: str
    tagline: str
    usd_per_second: str
    available: bool


class ScriptModelOption(BaseModel):
    model_id: str          # '' = platform default
    name: str
    tagline: str
    usd_per_m_input: str
    usd_per_m_output: str
    available: bool


@router.get("/video-models", response_model=list[VideoModelOption])
async def list_video_models(ctx: AuthCtx = CurrentUser) -> list[VideoModelOption]:
    options = [
        VideoModelOption(
            provider="grok", model_id="", name="Grok Imagine (default)",
            tagline="xAI image-to-video — the stock renderer",
            usd_per_second="0.050", available=bool(settings.xai_api_key),
        )
    ]
    fal_ok = fal_video.enabled()
    for m in fal_video.FAL_VIDEO_MODELS:
        options.append(VideoModelOption(
            provider="fal", model_id=m.id, name=m.name, tagline=m.tagline,
            usd_per_second=str(m.usd_per_second), available=fal_ok,
        ))
    return options


@router.get("/script-models", response_model=list[ScriptModelOption])
async def list_script_models(ctx: AuthCtx = CurrentUser) -> list[ScriptModelOption]:
    options = [
        ScriptModelOption(
            model_id="", name=f"Platform default ({settings.agent_model})",
            tagline="The stock scriptwriter model",
            usd_per_m_input="-", usd_per_m_output="-", available=True,
        )
    ]
    or_ok = openrouter.enabled()
    for m in openrouter.OPENROUTER_MODELS:
        options.append(ScriptModelOption(
            model_id=m.id, name=m.name, tagline=m.tagline,
            usd_per_m_input=str(m.usd_per_m_input),
            usd_per_m_output=str(m.usd_per_m_output),
            available=or_ok,
        ))
    return options
