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
from decimal import Decimal
from pathlib import Path
from typing import Any

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
    # Extra request fields some models require.
    extra_body: dict[str, Any] = {}


# Curated image-to-video models. Prices are per rendered second.
FAL_VIDEO_MODELS: list[FalVideoModel] = [
    FalVideoModel(
        id="fal-ai/kling-video/v2.1/standard/image-to-video",
        name="Kling 2.1 Standard",
        tagline="Great motion coherence, strong price/quality",
        usd_per_second=Decimal("0.05"),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/kling-video/v2.1/pro/image-to-video",
        name="Kling 2.1 Pro",
        tagline="Sharper detail and camera control",
        usd_per_second=Decimal("0.09"),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/minimax/hailuo-02/standard/image-to-video",
        name="Hailuo 02 Standard",
        tagline="Expressive character/subject motion",
        usd_per_second=Decimal("0.045"),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/luma-dream-machine/ray-2",
        name="Luma Ray 2",
        tagline="Cinematic physics and lighting",
        usd_per_second=Decimal("0.18"),
        max_duration_sec=9,
    ),
    FalVideoModel(
        id="fal-ai/wan/v2.2-a14b/image-to-video",
        name="Wan 2.2 (14B)",
        tagline="Budget open-weights option",
        usd_per_second=Decimal("0.04"),
        max_duration_sec=8,
    ),
]

_BY_ID = {m.id: m for m in FAL_VIDEO_MODELS}


class FalVideoError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(settings.fal_api_key)


def get_model(model_id: str) -> FalVideoModel | None:
    return _BY_ID.get(model_id)


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

    duration = max(1, min(model.max_duration_sec, int(round(duration_sec))))
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
        cost = video_cost(model, duration)
        await spend.log(
            provider=PROVIDER,
            sku=model.id,
            units=Decimal(duration),
            cost_usd=cost,
        )
    return out_path
