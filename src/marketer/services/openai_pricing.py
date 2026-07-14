"""Centralized OpenAI pricing & cost helpers.

Prices are sourced from openai.com/api/pricing as of 2026-05. Update the
table when OpenAI publishes new tiers. Cost helpers return Decimals so
they round-trip cleanly into spend_ledger.cost_usd (numeric(10,4)).
"""
from __future__ import annotations

from decimal import Decimal

# gpt-image-1 per-image, square 1024x1024. Portrait 1024x1536 (what we
# render for 9:16) is billed at the same step as square at each quality.
GPT_IMAGE_1_USD_PER_IMAGE: dict[str, Decimal] = {
    "low":    Decimal("0.011"),
    "medium": Decimal("0.042"),
    "high":   Decimal("0.167"),
}

# gpt-4o-mini-tts: $0.015 per minute of generated audio.
GPT_4O_MINI_TTS_USD_PER_MINUTE = Decimal("0.015")

# Pre-flight estimate: $0.015 per 1000 input characters (conservative upper
# bound used before the actual audio duration is known).
GPT_4O_MINI_TTS_USD_PER_1K_CHARS = Decimal("0.015")

# whisper-1: $0.006 per minute of input audio (billed per second, rounded up).
WHISPER_1_USD_PER_MINUTE = Decimal("0.006")


def image_cost(quality: str, n_images: int = 1) -> Decimal:
    per = GPT_IMAGE_1_USD_PER_IMAGE.get(quality)
    if per is None:
        raise ValueError(f"unknown gpt-image-1 quality: {quality!r}")
    return per * Decimal(n_images)


def tts_cost(seconds: float) -> Decimal:
    return (GPT_4O_MINI_TTS_USD_PER_MINUTE * Decimal(str(seconds)) / Decimal(60)).quantize(
        Decimal("0.0001")
    )


def tts_cost_estimated(char_count: int) -> Decimal:
    """Conservative pre-flight cost estimate for TTS based on input length.

    Uses $0.015 per 1000 characters as a proxy before output duration is
    known. Rounded up to nearest $0.0001.
    """
    return (GPT_4O_MINI_TTS_USD_PER_1K_CHARS * Decimal(char_count) / Decimal(1000)).quantize(
        Decimal("0.0001")
    )


def whisper_cost(seconds: float) -> Decimal:
    return (WHISPER_1_USD_PER_MINUTE * Decimal(str(seconds)) / Decimal(60)).quantize(
        Decimal("0.0001")
    )
