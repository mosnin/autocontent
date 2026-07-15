"""gpt-4o-mini-tts voiceover.

Streams the response straight to disk as WAV. `style_directions` is
passed verbatim to `instructions=` so the niche config can steer the
delivery ("calm and conspiratorial", "high-energy podcast host").
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from openai import AsyncOpenAI
from opentelemetry import trace
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings
from .openai_pricing import tts_cost, tts_cost_estimated
from .spend_context import SpendContext

PROVIDER = "openai"
SKU = "gpt-4o-mini-tts"
DEFAULT_VOICE = "onyx"

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def _wav_duration_seconds(path: Path) -> float:
    """Read WAV header to compute duration (avoids pulling in ffprobe)."""
    import wave

    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
        return frames / float(rate) if rate else 0.0


# Only the provider call is retried; the cap pre-flight and spend
# recording run exactly once (retrying them re-spends or retries
# SpendCapExceeded past the daily cap).
@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type(Exception),
)
async def _call_api(out_path: Path, kwargs: dict) -> None:
    client = _get_client()
    async with client.audio.speech.with_streaming_response.create(**kwargs) as response:
        await response.stream_to_file(out_path)


async def synthesize(
    text: str,
    out_path: Path,
    *,
    voice: str = DEFAULT_VOICE,
    style_directions: str | None = None,
    spend: SpendContext | None = None,
) -> Path:
    if spend is not None:
        await spend.ensure_can_spend(tts_cost_estimated(len(text)))
    out_path.parent.mkdir(parents=True, exist_ok=True)

    kwargs: dict = {
        "model": SKU,
        "voice": voice,
        "input": text,
        "response_format": "wav",
    }
    if style_directions:
        kwargs["instructions"] = style_directions

    await _call_api(out_path, kwargs)

    if spend is not None:
        seconds = _wav_duration_seconds(out_path)
        cost = tts_cost(seconds)
        span = trace.get_current_span()
        span.set_attribute("openai.sku", SKU)
        span.set_attribute("openai.tts_seconds", round(seconds, 4))
        span.set_attribute("marketer.cost_usd", str(cost))
        await spend.log(
            provider=PROVIDER,
            sku=SKU,
            units=Decimal(str(round(seconds, 4))),
            cost_usd=cost,
        )
    return out_path
