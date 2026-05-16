"""Grok Imagine (xAI) image-to-video animation.

API shape (verified against docs.x.ai 2026-05):

  POST https://api.x.ai/v1/videos/generations
    Authorization: Bearer $XAI_API_KEY
    Content-Type:  application/json
    body: {
      "model": "grok-imagine-video",
      "prompt": "...",
      "image": "data:image/png;base64,...",
      "duration": 5,                     # 1..15 seconds
      "aspect_ratio": "9:16",
      "resolution": "480p"               # or "720p"
    }
  -> 200 { "request_id": "<uuid>" }

  GET  https://api.x.ai/v1/videos/{request_id}
  -> 200 { "status": "pending" | "done" | "failed" | "expired", ... }
     when done: { "status": "done", "video": { "url": "https://...mp4", "duration": 8 } }

The keyframe is sent inline as a base64 data URI so we don't need to
host it anywhere first; the docs explicitly call out base64 strings as
an accepted shape for `image`.

Spend: $0.050/sec, billed against the rendered video duration.
"""
from __future__ import annotations

import asyncio
import base64
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..config import settings
from .spend_context import SpendContext
from .xai_pricing import imagine_video_cost

PROVIDER = "xai"
SKU = "grok-imagine-video"
BASE_URL = "https://api.x.ai/v1"
DEFAULT_RESOLUTION = "480p"
POLL_INTERVAL_SEC = 4.0
POLL_TIMEOUT_SEC = 600.0  # 10 min — generation typically completes in <2min
HTTP_TIMEOUT_SEC = 60.0


class GrokImagineError(RuntimeError):
    pass


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=BASE_URL,
        timeout=HTTP_TIMEOUT_SEC,
        headers={
            "Authorization": f"Bearer {settings.xai_api_key}",
            "Content-Type": "application/json",
        },
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
async def _submit(client: httpx.AsyncClient, body: dict[str, Any]) -> str:
    resp = await client.post("/videos/generations", json=body)
    resp.raise_for_status()
    request_id = resp.json().get("request_id")
    if not request_id:
        raise GrokImagineError(f"submit response missing request_id: {resp.text!r}")
    return request_id


async def _poll(client: httpx.AsyncClient, request_id: str) -> dict[str, Any]:
    deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT_SEC
    while True:
        resp = await client.get(f"/videos/{request_id}")
        resp.raise_for_status()
        body = resp.json()
        status = body.get("status")
        if status == "done":
            return body
        if status in ("failed", "expired"):
            raise GrokImagineError(f"job {request_id} {status}: {body!r}")
        if asyncio.get_event_loop().time() >= deadline:
            raise GrokImagineError(f"job {request_id} timed out after {POLL_TIMEOUT_SEC}s")
        await asyncio.sleep(POLL_INTERVAL_SEC)


async def _download(client: httpx.AsyncClient, url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    async with client.stream("GET", url) as resp:
        resp.raise_for_status()
        with out_path.open("wb") as fp:
            async for chunk in resp.aiter_bytes():
                fp.write(chunk)


async def animate(
    keyframe_path: Path,
    motion_prompt: str,
    out_path: Path,
    *,
    duration_sec: float = 5.0,
    aspect_ratio: str = "9:16",
    resolution: str = DEFAULT_RESOLUTION,
    spend: SpendContext | None = None,
) -> Path:
    """Submit a keyframe + motion prompt to Grok Imagine, poll, download mp4."""
    if spend is not None:
        await spend.ensure_can_spend(imagine_video_cost(duration_sec))
    duration = max(1, min(15, int(round(duration_sec))))
    body = {
        "model": SKU,
        "prompt": motion_prompt,
        "image": _image_to_data_uri(keyframe_path),
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
    }

    async with _client() as client:
        request_id = await _submit(client, body)
        result = await _poll(client, request_id)
        video = result.get("video") or {}
        video_url = video.get("url")
        if not video_url:
            raise GrokImagineError(f"job {request_id} done but no video.url: {result!r}")
        await _download(client, video_url, out_path)

    if spend is not None:
        billed_seconds = float(video.get("duration", duration))
        await spend.log(
            provider=PROVIDER,
            sku=SKU,
            units=Decimal(str(billed_seconds)),
            cost_usd=imagine_video_cost(billed_seconds),
        )
    return out_path
