"""Centralized OpenAI pricing & cost helpers.

Prices are sourced from openai.com/api/pricing as of 2026-05. Update the
table when OpenAI publishes new tiers. Cost helpers return Decimals so
they round-trip cleanly into spend_ledger.cost_usd (numeric(10,4)).
"""
from __future__ import annotations

from decimal import Decimal

# gpt-image-1 per-image, by size. Portrait/landscape 1024x1536 (what we
# render for 9:16) is billed ~1.5x the square tier at each quality —
# do NOT assume they match; under-pricing here silently undercuts every
# spend cap and hosted-billing debit downstream.
GPT_IMAGE_1_USD_PER_IMAGE: dict[str, dict[str, Decimal]] = {
    "1024x1024": {
        "low":    Decimal("0.011"),
        "medium": Decimal("0.042"),
        "high":   Decimal("0.167"),
    },
    "1024x1536": {
        "low":    Decimal("0.016"),
        "medium": Decimal("0.063"),
        "high":   Decimal("0.25"),
    },
    "1536x1024": {
        "low":    Decimal("0.016"),
        "medium": Decimal("0.063"),
        "high":   Decimal("0.25"),
    },
}

# gpt-4o-mini-tts: $0.015 per minute of generated audio.
GPT_4O_MINI_TTS_USD_PER_MINUTE = Decimal("0.015")

# Pre-flight estimate: $0.015 per 1000 input characters (conservative upper
# bound used before the actual audio duration is known).
GPT_4O_MINI_TTS_USD_PER_1K_CHARS = Decimal("0.015")

# whisper-1: $0.006 per minute of input audio (billed per second, rounded up).
WHISPER_1_USD_PER_MINUTE = Decimal("0.006")

# Chat/agent models, USD per 1M tokens (input, output). Every Agents-SDK
# call is metered through SpendContext with these rates.
LLM_USD_PER_MTOK: dict[str, tuple[Decimal, Decimal]] = {
    "gpt-5.4-mini": (Decimal("0.75"), Decimal("4.50")),
}

# Conservative fallback for models missing from the table: bill at the
# highest known rate rather than letting spend go unmetered.
_LLM_FALLBACK = (Decimal("0.75"), Decimal("4.50"))

# Pre-flight estimate for one agent run (used to gate the call before
# real token counts exist). Intentionally a small upper bound.
LLM_CALL_ESTIMATE_USD = Decimal("0.05")


def image_cost(quality: str, n_images: int = 1, *, size: str = "1024x1536") -> Decimal:
    tiers = GPT_IMAGE_1_USD_PER_IMAGE.get(size)
    if tiers is None:
        raise ValueError(f"unknown gpt-image-1 size: {size!r}")
    per = tiers.get(quality)
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


def llm_cost(model: str, input_tokens: int, output_tokens: int) -> Decimal:
    in_rate, out_rate = LLM_USD_PER_MTOK.get(model, _LLM_FALLBACK)
    mtok = Decimal(1_000_000)
    cost = (in_rate * Decimal(input_tokens) + out_rate * Decimal(output_tokens)) / mtok
    return cost.quantize(Decimal("0.0001"))


def whisper_cost(seconds: float) -> Decimal:
    return (WHISPER_1_USD_PER_MINUTE * Decimal(str(seconds)) / Decimal(60)).quantize(
        Decimal("0.0001")
    )
