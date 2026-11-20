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
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..observability import model_span
from .openai_pricing import tts_cost, tts_cost_estimated
from .retry_policy import is_transient_openai_error
from .spend_context import SpendContext

PROVIDER = "openai"
SKU = "gpt-4o-mini-tts"
DEFAULT_VOICE = "onyx"

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        # Explicit timeout (the SDK default is 10 minutes). max_retries=0: the
        # tenacity policy on the call is the only retry, so attempts do not
        # multiply (3 here x 3 in the SDK).
        _client = AsyncOpenAI(
            api_key=settings.openai_api_key, timeout=120.0, max_retries=0
        )
    return _client


def _wav_duration_seconds(path: Path) -> float:
    """Read WAV header to compute duration (avoids pulling in ffprobe)."""
    import wave

    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
        return frames / float(rate) if rate else 0.0


# Only the provider call is retried, and only on transient errors
# (connection/timeout/429/5xx); the cap pre-flight and spend recording
# run exactly once (retrying them re-spends or retries SpendCapExceeded
# past the daily cap).
@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(is_transient_openai_error),
)
async def _call_api(out_path: Path, kwargs: dict) -> None:
    client = _get_client()
    tmp_path = out_path.with_suffix(out_path.suffix + ".part")
    async with client.audio.speech.with_streaming_response.create(**kwargs) as response:
        await response.stream_to_file(tmp_path)
    # Atomic rename so a killed container or exhausted retry can never
    # leave a truncated voiceover.wav behind for stage-resume to reuse.
    tmp_path.replace(out_path)


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

    async with model_span(
        "generate_content",
        model=SKU,
        provider=PROVIDER,
        tenant_id=spend.user_id if spend is not None else None,
        name=f"gen_ai.speech {SKU}",
        attributes={"gen_ai.output.type": "speech", "marketer.tts.voice": voice, "marketer.tts.chars": len(text)},
    ) as call:
        # The script is content (masked, or left out in metadata mode); the
        # style directions are ours.
        call.prompt(([{"role": "system", "content": style_directions}] if style_directions else []) + [{"role": "user", "content": text}])
        await _call_api(out_path, kwargs)

        if spend is not None:
            seconds = _wav_duration_seconds(out_path)
            cost = tts_cost(seconds)
            span = trace.get_current_span()
            span.set_attribute("openai.sku", SKU)
            span.set_attribute("openai.tts_seconds", round(seconds, 4))
            call.cost(cost)
            await spend.log(
                provider=PROVIDER,
                sku=SKU,
                units=Decimal(str(round(seconds, 4))),
                cost_usd=cost,
            )
    return out_path
