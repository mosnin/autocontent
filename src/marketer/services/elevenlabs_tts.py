"""ElevenLabs text-to-speech — the premium voiceover option.

Per-niche opt-in (`voice_provider='elevenlabs'` + a voice id); the stock
gpt-4o-mini-tts path is untouched. Config-gated on
`MARKETER_ELEVENLABS_API_KEY` — a niche selecting ElevenLabs without the
key fails with a clear error instead of silently downgrading, so the
operator knows the voice they picked is not the voice being shipped.

The API streams raw PCM (`output_format=pcm_24000`); we wrap it in a WAV
header ourselves so downstream stages (ffmpeg mix, whisper captions,
render QA's WAV duration probe) see exactly the same file shape the
OpenAI path produces.

Pricing is pinned per 1k characters (ElevenLabs bills credits/char;
registry-style pin matches how fal/openrouter prices are handled).
"""
from __future__ import annotations

import wave
from decimal import Decimal
from pathlib import Path

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from .spend_context import SpendContext

PROVIDER = "elevenlabs"
API_BASE = "https://api.elevenlabs.io/v1"
HTTP_TIMEOUT_SEC = 120.0

SAMPLE_RATE = 24_000  # matches output_format=pcm_24000
USD_PER_1K_CHARS = Decimal("0.15")


class ElevenLabsError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(settings.elevenlabs_api_key)


def tts_cost(char_count: int) -> Decimal:
    return (USD_PER_1K_CHARS * Decimal(char_count) / Decimal(1000)).quantize(
        Decimal("0.0001")
    )


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429,) or exc.response.status_code >= 500
    return isinstance(exc, httpx.HTTPError)


def _write_wav(pcm: bytes, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".part")
    with wave.open(str(tmp_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    # Atomic rename — stage-resume must never reuse a truncated VO.
    tmp_path.replace(out_path)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _call_api(text: str, voice_id: str) -> bytes:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            f"{API_BASE}/text-to-speech/{voice_id}",
            params={"output_format": "pcm_24000"},
            headers={"xi-api-key": settings.elevenlabs_api_key},
            json={
                "text": text,
                "model_id": settings.elevenlabs_model_id,
            },
        )
        resp.raise_for_status()
        return resp.content


async def synthesize(
    text: str,
    out_path: Path,
    *,
    voice_id: str = "",
    spend: SpendContext | None = None,
) -> Path:
    """Synthesize `text` into a mono 24kHz WAV at `out_path`."""
    if not enabled():
        raise ElevenLabsError(
            "elevenlabs voice selected but MARKETER_ELEVENLABS_API_KEY is not set"
        )
    voice = voice_id or settings.elevenlabs_default_voice_id
    cost = tts_cost(len(text))
    if spend is not None:
        await spend.ensure_can_spend(cost)

    pcm = await _call_api(text, voice)
    if not pcm:
        raise ElevenLabsError("elevenlabs returned an empty audio body")
    _write_wav(pcm, out_path)

    if spend is not None:
        await spend.log(
            provider=PROVIDER,
            sku=settings.elevenlabs_model_id,
            units=Decimal(len(text)),
            cost_usd=cost,
        )
    return out_path
