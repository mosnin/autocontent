"""Generative background music (ElevenLabs Music).

Composes an original, licensed track from the niche's music mood instead
of searching a stock library — every video gets score written for *its*
duration and vibe, and there is no risk of the same Pixabay track
appearing across creators.

Strictly additive: `music.pick_track` (local library → Pixabay → silent)
remains the fallback chain. The pipeline only calls this when the niche
opts in (`music_provider` 'generated', or 'auto' with the key present)
and treats any failure as "no generated track" — music can never fail a
video.

API (docs.elevenlabs.io): POST /v1/music with a text prompt and
`music_length_ms`; the response body is the encoded track.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..logging import get_logger
from .spend_context import SpendContext

log = get_logger(__name__)

PROVIDER = "elevenlabs"
SKU = "music"
API_BASE = "https://api.elevenlabs.io/v1"
HTTP_TIMEOUT_SEC = 300.0

# Pinned per generated minute (registry-style, like fal/openrouter).
USD_PER_MINUTE = Decimal("0.50")

# API bounds on a single composition.
MIN_LENGTH_MS = 10_000
MAX_LENGTH_MS = 300_000


class MusicGenError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(settings.elevenlabs_api_key)


def music_cost(seconds: float) -> Decimal:
    return (USD_PER_MINUTE * Decimal(str(seconds)) / Decimal(60)).quantize(
        Decimal("0.0001")
    )


def build_prompt(mood: str, *, niche_title: str = "") -> str:
    base = mood or f"an instrumental background track for a video about {niche_title}"
    return (
        f"{base}. Instrumental only — absolutely no vocals, no spoken word. "
        "Background music for a short-form vertical video: a clear steady "
        "groove, gentle intro, consistent energy, clean ending. Mixed to sit "
        "under narration."
    )


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429,) or exc.response.status_code >= 500
    return isinstance(exc, httpx.HTTPError)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _call_api(prompt: str, length_ms: int) -> bytes:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        resp = await client.post(
            f"{API_BASE}/music",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": settings.elevenlabs_api_key},
            json={"prompt": prompt, "music_length_ms": length_ms},
        )
        resp.raise_for_status()
        return resp.content


async def compose(
    *,
    mood: str,
    duration_sec: int,
    out_path: Path,
    niche_title: str = "",
    spend: SpendContext | None = None,
) -> Path:
    """Compose an original instrumental track. Raises MusicGenError on any
    problem — the caller falls back to the stock library chain."""
    if not enabled():
        raise MusicGenError("MARKETER_ELEVENLABS_API_KEY is not set")

    length_ms = max(MIN_LENGTH_MS, min(MAX_LENGTH_MS, duration_sec * 1000))
    billed_sec = length_ms / 1000
    cost = music_cost(billed_sec)
    if spend is not None:
        await spend.ensure_can_spend(cost)

    try:
        audio = await _call_api(build_prompt(mood, niche_title=niche_title), length_ms)
    except httpx.HTTPError as exc:
        raise MusicGenError(f"music generation failed: {exc}") from exc
    if not audio:
        raise MusicGenError("music generation returned an empty body")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".part")
    tmp_path.write_bytes(audio)
    tmp_path.replace(out_path)

    if spend is not None:
        await spend.log(
            provider=PROVIDER,
            sku=SKU,
            units=Decimal(str(round(billed_sec, 3))),
            cost_usd=cost,
        )
    log.info(
        "music.generated",
        extra={"mood": mood, "length_ms": length_ms, "dest": str(out_path)},
    )
    return out_path
