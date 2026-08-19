"""Whole-run cost estimates and the up-front prepaid-credit gate.

Mirrors the client-side preview (web/lib/cost-estimator.ts) but uses the
authoritative server pricing tables, so the API can refuse a spend-creating
request up front when prepaid credit can't cover it. A $0 balance must fail
at the button with a human message — never deep inside a pipeline as a raw
SpendCapExceeded.

The figures are estimates, not quotes: every pipeline still meters its real
calls through SpendContext, which remains the final gate. The video estimate
deliberately includes everything default-on (portrait-tier images, generated
music when it would actually run, an LLM allowance for the agent stages) so
a user who passes this gate does not die mid-pipeline on a debit the
estimate ignored.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from .openai_pricing import (
    GPT_4O_MINI_TTS_USD_PER_MINUTE,
    LLM_CALL_ESTIMATE_USD,
    WHISPER_1_USD_PER_MINUTE,
    image_cost,
)
from .xai_pricing import IMAGINE_VIDEO_USD_PER_SECOND

# One video run makes roughly half a dozen metered agent calls
# (ideation, script, visual direction, QA, captions...).
LLM_RUN_ALLOWANCE_USD = LLM_CALL_ESTIMATE_USD * 6

# Cheap-pipeline floors for the non-video spend surfaces. Articles are a
# handful of LLM stages plus an optional hero image; image posts are a
# plan call plus a few gpt-image-1 renders. Both far below a video — the
# point of gating them is only that $0 can't enqueue anything.
ARTICLE_ESTIMATE_USD = Decimal("0.40")
IMAGE_POST_ESTIMATE_USD = Decimal("0.40")
TEMPLATE_REMIX_ESTIMATE_USD = Decimal("0.30")


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


def _music_estimate_usd(niche: _NicheLike, target_sec: int) -> Decimal:
    """Generated-music cost, included only when the run would actually
    generate a track (brief has music on, and the provider resolves to
    the generated engine on this deploy)."""
    brief = getattr(niche, "creative_brief", None)
    audio = getattr(brief, "audio", None) if brief is not None else None
    if audio is not None and not getattr(audio, "music_enabled", True):
        return Decimal("0")

    provider = getattr(niche, "music_provider", "auto")
    if provider == "library":
        return Decimal("0")
    if provider == "auto":
        from ..config import settings

        if not settings.elevenlabs_api_key:
            return Decimal("0")

    from .music_gen import USD_PER_MINUTE as MUSIC_USD_PER_MINUTE

    return MUSIC_USD_PER_MINUTE * Decimal(target_sec) / Decimal(60)


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
    music = _music_estimate_usd(niche, target_sec)

    total = (
        images + video + tts + whisper + character_sheet + music + LLM_RUN_ALLOWANCE_USD
    )
    return total.quantize(Decimal("0.0001"))


def estimated_charge_usd(niche: _NicheLike) -> Decimal:
    """The estimate as it would hit the prepaid balance (margin included)."""
    from ..config import settings

    margin = Decimal(str(settings.billing_margin))
    return (estimate_run_cost_usd(niche) * margin).quantize(Decimal("0.01"))


def _usd(amount: Decimal) -> str:
    """Sign-correct short dollar string: -$0.50, never $-0.50."""
    q = amount.quantize(Decimal("0.01"))
    return f"-${-q}" if q < 0 else f"${q}"


async def refuse_if_credit_below(
    user_id: str, estimated_usd: Decimal, *, what: str
) -> None:
    """Raise fastapi.HTTPException(402) when billing is on and the user's
    balance can't cover ``estimated_usd`` (pre-margin) for ``what``.

    The message is written for the person holding the button; clients
    render an "Add credit" action alongside it.
    """
    from ..config import settings

    if not settings.billing_enabled:
        return

    from fastapi import HTTPException

    from ..repos import billing as billing_repo

    balance = await billing_repo.balance(user_id)
    charge = (estimated_usd * Decimal(str(settings.billing_margin))).quantize(
        Decimal("0.01")
    )
    if balance < charge:
        raise HTTPException(
            402,
            detail=(
                f"{what} is estimated at {_usd(charge)} and you have "
                f"{_usd(balance)} of credit. Add credit to run it."
            ),
        )


async def refuse_if_credit_short(user_id: str, niche: _NicheLike) -> None:
    """The video-run gate: estimate this niche's run and refuse on shortfall."""
    from ..config import settings

    if not settings.billing_enabled:
        return
    await refuse_if_credit_below(
        user_id, estimate_run_cost_usd(niche), what="This run"
    )
