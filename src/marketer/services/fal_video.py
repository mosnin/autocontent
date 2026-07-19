"""Fal-hosted image-to-video models (queue API).

Alternative animation backend to Grok Imagine: the niche picks
`video_provider='fal'` plus one of the curated models below, and every
scene clip renders through Fal instead. Config-gated on
`MARKETER_FAL_API_KEY` — without it the pipeline refuses cleanly at
submit time (jobs fail with a clear error, never a KeyError).

Queue flow (docs.fal.ai):

  POST https://queue.fal.run/{model}
    Authorization: Key $FAL_KEY
    body: { "prompt": ..., "image_url": "data:image/png;base64,...",
            "duration": "5", ... }
  -> 200 { "request_id", "status_url", "response_url" }

  GET {status_url}  -> { "status": "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED" }
  GET {response_url} -> { "video": { "url": "https://...mp4" } }

Pricing is a curated registry (per second of rendered video, matching
Fal's published unit prices at integration time). Every render logs a
spend_ledger row with provider="fal" and the model id as the SKU, so
per-model costs are visible in cost-by-job and billing exactly like
Grok/OpenAI spend.
"""
from __future__ import annotations

import asyncio
import base64
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings
from .spend_context import SpendContext

PROVIDER = "fal"
QUEUE_BASE = "https://queue.fal.run"
POLL_INTERVAL_SEC = 4.0
POLL_TIMEOUT_SEC = 600.0
HTTP_TIMEOUT_SEC = 60.0


class FalVideoModel(BaseModel):
    id: str            # fal model path, e.g. "fal-ai/kling-video/v2.1/standard/image-to-video"
    name: str          # display name for the UI dropdown
    tagline: str
    usd_per_second: Decimal
    max_duration_sec: int = 10
    # Durations the endpoint actually accepts (enum on most fal models);
    # requests snap to the nearest allowed value.
    allowed_durations: tuple[int, ...] = (5, 10)
    # Extra request fields some models require.
    extra_body: dict[str, Any] = {}
    # 'i2v' animates a keyframe from a motion prompt; 'avatar' is
    # audio-driven (image + voiceover in, lip-synced talking video out).
    kind: Literal["i2v", "avatar"] = "i2v"


def snap_duration(model: "FalVideoModel", requested_sec: float) -> int:
    return min(model.allowed_durations, key=lambda d: abs(d - requested_sec))


# Curated image-to-video models. Prices are per rendered second.
FAL_VIDEO_MODELS: list[FalVideoModel] = [
    FalVideoModel(
        id="fal-ai/kling-video/v2.1/standard/image-to-video",
        name="Kling 2.1 Standard",
        tagline="Great motion coherence, strong price/quality",
        usd_per_second=Decimal("0.05"),
        allowed_durations=(5, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/kling-video/v2.1/pro/image-to-video",
        name="Kling 2.1 Pro",
        tagline="Sharper detail and camera control",
        usd_per_second=Decimal("0.09"),
        allowed_durations=(5, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/minimax/hailuo-02/standard/image-to-video",
        name="Hailuo 02 Standard",
        tagline="Expressive character/subject motion",
        usd_per_second=Decimal("0.045"),
        allowed_durations=(6, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/luma-dream-machine/ray-2",
        name="Luma Ray 2",
        tagline="Cinematic physics and lighting",
        usd_per_second=Decimal("0.18"),
        allowed_durations=(5, 9),
        max_duration_sec=9,
    ),
    FalVideoModel(
        id="fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
        name="Kling 2.5 Turbo Pro",
        tagline="Kling's latest — faster, sharper, stronger prompt adherence",
        usd_per_second=Decimal("0.07"),
        allowed_durations=(5, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/veo3/fast/image-to-video",
        name="Google Veo 3 Fast",
        tagline="Veo 3 quality at speed — best realism per dollar",
        usd_per_second=Decimal("0.10"),
        allowed_durations=(8,),
        max_duration_sec=8,
        extra_body={"generate_audio": False},
    ),
    FalVideoModel(
        id="fal-ai/veo3/image-to-video",
        name="Google Veo 3",
        tagline="State-of-the-art realism, physics, and cinematography",
        usd_per_second=Decimal("0.40"),
        allowed_durations=(8,),
        max_duration_sec=8,
        extra_body={"generate_audio": False},
    ),
    FalVideoModel(
        id="fal-ai/sora-2/image-to-video",
        name="OpenAI Sora 2",
        tagline="Long coherent shots with strong scene understanding",
        usd_per_second=Decimal("0.10"),
        allowed_durations=(4, 8, 12),
        max_duration_sec=12,
    ),
    FalVideoModel(
        id="fal-ai/pixverse/v5/image-to-video",
        name="Pixverse V5",
        tagline="Punchy stylized motion — great for animated looks",
        usd_per_second=Decimal("0.06"),
        allowed_durations=(5, 8),
        max_duration_sec=8,
    ),
    FalVideoModel(
        id="fal-ai/bytedance/omnihuman",
        name="OmniHuman (UGC avatar)",
        tagline="Lip-synced spokesperson from a single portrait — UGC mode",
        usd_per_second=Decimal("0.16"),
        allowed_durations=(5, 10, 15),
        max_duration_sec=15,
        kind="avatar",
    ),
    FalVideoModel(
        id="fal-ai/wan/v2.2-a14b/image-to-video",
        name="Wan 2.2 (14B)",
        tagline="Budget open-weights option",
        usd_per_second=Decimal("0.04"),
        allowed_durations=(5, 8),
        max_duration_sec=8,
    ),
]

_BY_ID = {m.id: m for m in FAL_VIDEO_MODELS}


class FalVideoError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(settings.fal_api_key)


def _price_overrides() -> dict[str, Decimal]:
    """Operator-supplied unit-price corrections, parsed per call.

    `MARKETER_FAL_PRICE_OVERRIDES='{"fal-ai/veo3/image-to-video": "0.45"}'`
    fixes registry drift against fal's published prices without a deploy
    of new code. Malformed JSON or values are ignored (never break
    rendering over a pricing knob)."""
    raw = settings.fal_price_overrides
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        out: dict[str, Decimal] = {}
        for key, val in parsed.items():
            try:
                price = Decimal(str(val))
            except (InvalidOperation, ValueError):
                continue
            if price > 0:
                out[str(key)] = price
        return out
    except (json.JSONDecodeError, AttributeError, TypeError):
        return {}


def get_model(model_id: str) -> FalVideoModel | None:
    model = _BY_ID.get(model_id)
    if model is None:
        return None
    override = _price_overrides().get(model_id)
    if override is not None and override != model.usd_per_second:
        return model.model_copy(update={"usd_per_second": override})
    return model


def list_models() -> list[FalVideoModel]:
    """The registry with price overrides applied — what the UI and
    metering should see."""
    return [get_model(m.id) or m for m in FAL_VIDEO_MODELS]


def video_cost(model: FalVideoModel, seconds: float) -> Decimal:
    return (model.usd_per_second * Decimal(str(seconds))).quantize(Decimal("0.0001"))


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SEC,
        headers={"Authorization": f"Key {settings.fal_api_key}"},
    )


def _image_to_data_uri(path: Path) -> str:
    suffix = path.suffix.lstrip(".").lower() or "png"
    mime = {"jpg": "jpeg"}.get(suffix, suffix)
    return f"data:image/{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def _audio_to_data_uri(path: Path) -> str:
    suffix = path.suffix.lstrip(".").lower() or "wav"
    mime = {"wav": "wav", "mp3": "mpeg", "m4a": "mp4"}.get(suffix, suffix)
    return f"data:audio/{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def _wav_duration_seconds(path: Path) -> float:
    import wave

    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
        return frames / float(rate) if rate else 0.0


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type((httpx.HTTPError,)),
)
async def _submit(client: httpx.AsyncClient, model_id: str, body: dict) -> dict:
    resp = await client.post(f"{QUEUE_BASE}/{model_id}", json=body)
    resp.raise_for_status()
    out = resp.json()
    if not out.get("status_url") or not out.get("response_url"):
        raise FalVideoError(f"queue response missing urls: {out!r}")
    return out


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type((httpx.HTTPError,)),
)
async def _poll_once(client: httpx.AsyncClient, status_url: str) -> dict:
    resp = await client.get(status_url)
    resp.raise_for_status()
    return resp.json()


async def _await_completion(client: httpx.AsyncClient, status_url: str) -> None:
    deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT_SEC
    while True:
        body = await _poll_once(client, status_url)
        status = body.get("status")
        if status == "COMPLETED":
            return
        if status in ("FAILED", "CANCELLED", "ERROR"):
            raise FalVideoError(f"fal request {status}: {body!r}")
        if asyncio.get_event_loop().time() >= deadline:
            raise FalVideoError(f"fal request timed out after {POLL_TIMEOUT_SEC}s")
        await asyncio.sleep(POLL_INTERVAL_SEC)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception_type((httpx.HTTPError,)),
)
async def _download(client: httpx.AsyncClient, url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".part")
    async with client.stream("GET", url) as resp:
        resp.raise_for_status()
        with tmp_path.open("wb") as fp:
            async for chunk in resp.aiter_bytes():
                fp.write(chunk)
    tmp_path.replace(out_path)


async def animate(
    keyframe_path: Path,
    motion_prompt: str,
    out_path: Path,
    *,
    model_id: str,
    duration_sec: float = 5.0,
    spend: SpendContext | None = None,
) -> Path:
    """Render one scene clip through a Fal image-to-video model."""
    if not enabled():
        raise FalVideoError(
            "fal video provider selected but MARKETER_FAL_API_KEY is not set"
        )
    model = get_model(model_id)
    if model is None:
        raise FalVideoError(f"unknown fal model {model_id!r}")

    # Snap to the model's accepted duration enum — arbitrary integers 400
    # on most fal endpoints, killing the job after the keyframe was paid for.
    duration = snap_duration(model, duration_sec)
    if spend is not None:
        await spend.ensure_can_spend(video_cost(model, duration))

    body = {
        "prompt": motion_prompt,
        "image_url": _image_to_data_uri(keyframe_path),
        "duration": str(duration),
        **model.extra_body,
    }

    async with _client() as client:
        queued = await _submit(client, model.id, body)
        await _await_completion(client, queued["status_url"])
        resp = await client.get(queued["response_url"])
        resp.raise_for_status()
        result = resp.json()
        video = result.get("video") or {}
        video_url = video.get("url")
        if not video_url:
            raise FalVideoError(f"completed but no video.url: {result!r}")
        await _download(client, video_url, out_path)

    if spend is not None:
        # Bill the seconds fal actually rendered when reported (some
        # models return slightly different durations than requested).
        billed = float(video.get("duration") or duration)
        cost = video_cost(model, billed)
        await spend.log(
            provider=PROVIDER,
            sku=model.id,
            units=Decimal(str(billed)),
            cost_usd=cost,
        )
    return out_path


async def animate_avatar(
    keyframe_path: Path,
    audio_path: Path,
    out_path: Path,
    *,
    model_id: str,
    spend: SpendContext | None = None,
) -> Path:
    """Render a lip-synced talking clip: portrait keyframe + voiceover in,
    a video of that person speaking the audio out.

    Audio-driven models set their own output length from the voiceover, so
    there is no duration knob — the pre-flight estimate and the billed
    units both come from the audio (or the provider-reported render
    duration when present)."""
    if not enabled():
        raise FalVideoError(
            "fal video provider selected but MARKETER_FAL_API_KEY is not set"
        )
    model = get_model(model_id)
    if model is None:
        raise FalVideoError(f"unknown fal model {model_id!r}")
    if model.kind != "avatar":
        raise FalVideoError(f"{model_id!r} is not an audio-driven avatar model")

    audio_sec = max(1.0, _wav_duration_seconds(audio_path))
    if spend is not None:
        await spend.ensure_can_spend(video_cost(model, audio_sec))

    body = {
        "image_url": _image_to_data_uri(keyframe_path),
        "audio_url": _audio_to_data_uri(audio_path),
        **model.extra_body,
    }

    async with _client() as client:
        queued = await _submit(client, model.id, body)
        await _await_completion(client, queued["status_url"])
        resp = await client.get(queued["response_url"])
        resp.raise_for_status()
        result = resp.json()
        video = result.get("video") or {}
        video_url = video.get("url")
        if not video_url:
            raise FalVideoError(f"completed but no video.url: {result!r}")
        await _download(client, video_url, out_path)

    if spend is not None:
        billed = float(video.get("duration") or audio_sec)
        await spend.log(
            provider=PROVIDER,
            sku=model.id,
            units=Decimal(str(billed)),
            cost_usd=video_cost(model, billed),
        )
    return out_path
