"""Story video settings (``MARKETER_STORY_*``)."""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class StorySettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MARKETER_STORY_", env_file=".env", extra="ignore")

    # Text model for every writing stage. An OpenRouter id from the curated
    # registry (services/openrouter.py) when OpenRouter is configured;
    # otherwise the stages run on the OpenAI ``agent_model``.
    text_model: str = "anthropic/claude-sonnet-4.5"
    # A render whose estimate is at or above this needs a person with
    # spend:approve (rails action content.story.render).
    approval_usd: Decimal = Decimal("5")
    # Hard ceiling on one story video's total spend, checked before every
    # charge. Niche, global and credit caps still apply on top.
    max_usd: Decimal = Decimal("25")
    max_scenes: int = 4
    max_shots: int = 12
    max_characters: int = 4
    shot_seconds: int = 5
    image_quality: Literal["low", "medium", "high"] = "medium"
    video_provider: Literal["grok", "fal"] = "grok"
    fal_model: str = ""
    # Shots rendered at once within one story.
    parallel: int = 3


story_settings = StorySettings()
