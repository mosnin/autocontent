"""Word-level caption transcription via whisper-1."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from openai import AsyncOpenAI
from opentelemetry import trace
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings
from .openai_pricing import whisper_cost
from .spend_context import SpendContext

PROVIDER = "openai"
SKU = "whisper-1"

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def _audio_duration_seconds(path: Path) -> float:
    import wave

    try:
        with wave.open(str(path), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate()
            return frames / float(rate) if rate else 0.0
    except (wave.Error, EOFError):
        return 0.0


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type(Exception),
)
async def transcribe_word_level(
    audio_path: Path,
    *,
    spend: SpendContext | None = None,
) -> list[dict]:
    """Returns a list of {"word", "start", "end"} dicts."""
    if spend is not None:
        await spend.ensure_can_spend(whisper_cost(_audio_duration_seconds(audio_path)))
    client = _get_client()
    with audio_path.open("rb") as fp:
        result = await client.audio.transcriptions.create(
            model=SKU,
            file=fp,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )

    raw = getattr(result, "words", None) or []
    words: list[dict] = []
    for w in raw:
        d = w if isinstance(w, dict) else w.model_dump()
        words.append({"word": d["word"], "start": float(d["start"]), "end": float(d["end"])})

    if spend is not None:
        seconds = _audio_duration_seconds(audio_path)
        cost = whisper_cost(seconds)
        span = trace.get_current_span()
        span.set_attribute("openai.sku", SKU)
        span.set_attribute("openai.audio_seconds", round(seconds, 4))
        span.set_attribute("marketer.cost_usd", str(cost))
        await spend.log(
            provider=PROVIDER,
            sku=SKU,
            units=Decimal(str(round(seconds, 4))),
            cost_usd=cost,
        )
    return words
