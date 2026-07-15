"""Niche-draft agent: one sentence in, a full channel spec out.

This is the front door. A creator types "claymation videos explaining
economics for curious adults" and the model fills every field the
onboarding wizard would otherwise ask for — title, audience, visual
style, voice, cadence, hashtags — so they can review-and-launch instead
of filling a spec sheet.
"""
from __future__ import annotations

from typing import Literal

from agents import Agent
from pydantic import BaseModel, Field

from ..config import settings
from .metered import run_metered

# Voices the TTS layer supports — the model must pick one of these.
_VOICES = "alloy, echo, fable, onyx, nova, shimmer, ash, sage, coral"

DRAFT_INSTRUCTIONS = f"""You turn a one-sentence channel description into a
complete short-form video channel spec. Infer every field from the
description; make confident, specific choices a creator can tweak later.

Guidance:
- title: 2-4 words, the channel's name, not a sentence.
- description: one crisp sentence on what the channel publishes.
- target_audience: precisely scoped (never "everyone").
- visual_style: concrete art direction (medium, palette, mood) the image
  model can act on — e.g. "claymation, warm 3-point lighting, tactile".
- voice: choose the single best fit from: {_VOICES}.
- hashtags: 4-6 lowercase tags, no '#', relevant to the niche.
- target_duration_sec: 30-60 for most; longer only if the topic needs it.
- scene_count: 4-8. image_quality: 'medium' unless the style demands 'high'.
- video_resolution: '720p' for anything cinematic, else '480p'.
- tts_style_directions: a short delivery note matching the vibe
  (e.g. "calm and conspiratorial", "high-energy explainer").
"""


class NicheDraft(BaseModel):
    """LLM-authored channel spec. Mirrors the onboarding wizard fields the
    model can infer; scheduling + spend cap stay with the human."""

    title: str
    description: str
    target_audience: str
    hashtags: list[str] = Field(default_factory=list)
    visual_style: str
    voice: Literal[
        "alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "sage", "coral"
    ]
    target_duration_sec: int = Field(ge=15, le=90)
    scene_count: int = Field(ge=2, le=12)
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_resolution: Literal["480p", "720p"] = "480p"
    scene_max_duration_sec: int = Field(default=5, ge=1, le=15)
    tts_style_directions: str = ""


def build_niche_draft_agent() -> Agent:
    return Agent(
        model=settings.agent_model,
        name="NicheDraft",
        instructions=DRAFT_INSTRUCTIONS,
        output_type=NicheDraft,
    )


async def draft_niche(
    description: str, *, brand_context: str = "", spend=None
) -> NicheDraft:
    """Turn a one-line channel description into a full draft spec. When
    `brand_context` is provided (from the user's brand kit) the draft is
    steered to match that brand identity."""
    agent = build_niche_draft_agent()
    prompt = f"Channel description: {description}"
    if brand_context:
        prompt = f"{brand_context}\n\n{prompt}"
    result = await run_metered(agent, prompt, spend=spend)
    return result.final_output_as(NicheDraft)
