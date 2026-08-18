"""Whole-run cost estimate for one video pipeline run.

Mirrors the client-side preview (web/lib/cost-estimator.ts) but uses the
authoritative server pricing tables, so the API can refuse an enqueue up
front when prepaid credit can't cover the run. A $0 balance must fail at
the button with a human message — never deep inside the pipeline as a
raw SpendCapExceeded.

The figure is an estimate, not a quote: the pipeline still meters every
real call through SpendContext, which remains the final gate.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from .openai_pricing import (
    GPT_4O_MINI_TTS_USD_PER_MINUTE,
    WHISPER_1_USD_PER_MINUTE,
    image_cost,
)
from .xai_pricing import IMAGINE_VIDEO_USD_PER_SECOND


class _NicheLike(Protocol):
    scene_count: int
    image_quality: str
    scene_max_duration_sec: int
    target_duration_sec: int
    video_provider: str
    fal_model: str


def _video_rate_per_sec(niche: _NicheLike) -> Decimal:
    """Per-second animation rate for the niche's configured backend."""
    if getattr(niche, "video_provider", "grok") == "fal" and getattr(niche, "fal_model", ""):
        # Late import: fal_video pulls httpx/config; keep this module light.
        from .fal_video import get_model

        model = get_model(niche.fal_model)
        if model is not None:
            return model.usd_per_second
    return IMAGINE_VIDEO_USD_PER_SECOND


def estimate_run_cost_usd(niche: _NicheLike) -> Decimal:
    """Pre-margin USD estimate for producing one video on this niche.

    Keyframes and the character sheet render portrait 1024x1536, so the
    portrait image tier is used (the client preview historically used the
    cheaper square tier — this figure is the honest one).
    """
    scenes = max(0, int(niche.scene_count))
    scene_sec = max(0, int(niche.scene_max_duration_sec))
    target_sec = max(0, int(niche.target_duration_sec))

    images = image_cost(niche.image_quality, scenes, size="1024x1536")
    video = _video_rate_per_sec(niche) * Decimal(scenes * scene_sec)
    minutes = Decimal(target_sec) / Decimal(60)
    tts = GPT_4O_MINI_TTS_USD_PER_MINUTE * minutes
    whisper = WHISPER_1_USD_PER_MINUTE * minutes
    character_sheet = image_cost(niche.image_quality, 1, size="1024x1536")

    return (images + video + tts + whisper + character_sheet).quantize(Decimal("0.0001"))


def estimated_charge_usd(niche: _NicheLike) -> Decimal:
    """The estimate as it would hit the prepaid balance (margin included)."""
    from ..config import settings

    margin = Decimal(str(settings.billing_margin))
    return (estimate_run_cost_usd(niche) * margin).quantize(Decimal("0.01"))


async def refuse_if_credit_short(user_id: str, niche: _NicheLike) -> None:
    """Raise fastapi.HTTPException(402) when billing is on and the user's
    balance can't cover this run's estimated charge.

    The message is written for the person holding the button, and the
    client renders an "Add credit" action alongside it.
    """
    from ..config import settings

    if not settings.billing_enabled:
        return

    from fastapi import HTTPException

    from ..repos import billing as billing_repo

    balance = await billing_repo.balance(user_id)
    charge = estimated_charge_usd(niche)
    if balance < charge:
        raise HTTPException(
            402,
            detail=(
                f"This run is estimated at ${charge} and you have "
                f"${balance.quantize(Decimal('0.01'))} of credit. "
                "Add credit to run it."
            ),
        )
