"""fal.ai client for Content Studio tools.

Two call shapes:
- `run(model_id, payload)` — synchronous `POST https://fal.run/{model_id}`,
  for fast image ops (edit, upscale, remove-bg, text-to-image).
- `submit`/`poll` (or `run_queued` for both in one call) — the
  `https://queue.fal.run` flow for long-running jobs (image-to-video).

Fail-closed: every entry point raises `StudioDisabled` when
`settings.fal_api_key` is empty. Routes catch it and return 503 with a
message telling the operator which env var to set — Content Studio is
simply inert without a key, nothing else breaks.

`MODEL_REGISTRY` maps each tool kind ("image", "image_edit", "upscale",
"video", "remove_bg") to a default model id (from settings) plus a small
allowlist. A request can override the model within its kind but can't
drive fal.run against an arbitrary model id — `resolve_model` raises
`ModelNotAllowed` otherwise.

Response parsing is tolerant: fal model families shape their output
differently (`{"images": [...]}`, `{"image": {...}}`, `{"video": {...}}`,
...); `extract_asset_url` defensively finds the first asset URL.
"""
from __future__ import annotations

import asyncio
import base64
import mimetypes
from pathlib import Path
from typing import Any

import httpx

from ..config import settings

RUN_BASE_URL = "https://fal.run"
QUEUE_BASE_URL = "https://queue.fal.run"
HTTP_TIMEOUT_SEC = 120.0
POLL_INTERVAL_SEC = 3.0
POLL_TIMEOUT_SEC = 600.0  # 10 min — image-to-video generation is the slow path


class StudioDisabled(Exception):
    """Raised when MARKETER_FAL_API_KEY is unset. Routes map this to 503."""


class ModelNotAllowed(Exception):
    """Raised when a request asks for a model id outside its kind's allowlist."""


class FalError(RuntimeError):
    """A fal.ai call failed: non-2xx response, or a result we couldn't parse."""


def _require_key() -> str:
    if not settings.fal_api_key:
        raise StudioDisabled("Content Studio needs MARKETER_FAL_API_KEY")
    return settings.fal_api_key


def require_enabled() -> None:
    """Raise `StudioDisabled` if fal isn't configured. Call this first in
    every studio route so a missing key fails fast — before any DB work
    or spend pre-flight, not just before the eventual network call."""
    _require_key()


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Key {_require_key()}",
        "Content-Type": "application/json",
    }


def _registry() -> dict[str, dict[str, Any]]:
    """Built lazily (not at import time) so tests can monkeypatch settings
    before the registry is read."""
    return {
        "image": {
            "default": settings.fal_image_model,
            "allowed": {
                settings.fal_image_model,
                "fal-ai/flux/dev",
                "fal-ai/flux/schnell",
                "fal-ai/flux-pro/v1.1",
            },
        },
        "image_edit": {
            "default": settings.fal_image_edit_model,
            "allowed": {
                settings.fal_image_edit_model,
                "fal-ai/flux-pro/v1/fill",
                "fal-ai/flux-pro/v1/canny",
            },
        },
        "upscale": {
            "default": settings.fal_upscale_model,
            "allowed": {
                settings.fal_upscale_model,
                "fal-ai/clarity-upscaler",
                "fal-ai/esrgan",
            },
        },
        "video": {
            "default": settings.fal_video_model,
            "allowed": {
                settings.fal_video_model,
                "fal-ai/kling-video/v1.5/standard/image-to-video",
                "fal-ai/kling-video/v1.5/pro/image-to-video",
            },
        },
        "remove_bg": {
            "default": settings.fal_remove_bg_model,
            "allowed": {settings.fal_remove_bg_model, "fal-ai/birefnet"},
        },
    }


# Exposed for callers/tests that want to see the whole table at once.
MODEL_REGISTRY_KINDS = ("image", "image_edit", "upscale", "video", "remove_bg")


def resolve_model(kind: str, model: str | None) -> str:
    """Resolve a request's chosen model within `kind`'s allowlist.

    `model=None` (or empty) returns the configured default for `kind`. A
    non-empty `model` must be a member of that kind's allowlist —
    otherwise `ModelNotAllowed`, so a request can't drive fal.run against
    an arbitrary model id.
    """
    reg = _registry().get(kind)
    if reg is None:
        raise ValueError(f"unknown studio tool kind: {kind!r}")
    if not model:
        return reg["default"]
    if model not in reg["allowed"]:
        raise ModelNotAllowed(f"model {model!r} is not allowed for {kind!r}")
    return model


def to_data_uri(path: Path) -> str:
    """Encode a local file as a data: URI — fal's standard shape for
    inline image inputs (avoids needing to host the source somewhere
    first)."""
    mime, _ = mimetypes.guess_type(str(path))
    mime = mime or "application/octet-stream"
    b64 = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime};base64,{b64}"


def _client() -> httpx.AsyncClient:
    """Factory for the httpx client every network call goes through.

    A factory (rather than calling `httpx.AsyncClient(...)` inline) so
    tests can monkeypatch this one seam and inject an `httpx.MockTransport`
    — the same pattern `grok_imagine._client` uses — instead of hitting
    the network."""
    return httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC, headers=_headers())


async def run(model_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """`POST https://fal.run/{model_id}` — the synchronous call shape used
    by fast image ops. Returns the parsed JSON body."""
    _require_key()
    async with _client() as client:
        resp = await client.post(f"{RUN_BASE_URL}/{model_id}", json=payload)
        if resp.status_code >= 400:
            raise FalError(
                f"fal run {model_id} failed ({resp.status_code}): {resp.text[:500]}"
            )
        return resp.json()


async def submit(model_id: str, payload: dict[str, Any]) -> str:
    """`POST https://queue.fal.run/{model_id}` — enqueue a long-running job
    and return its request id."""
    _require_key()
    async with _client() as client:
        resp = await client.post(f"{QUEUE_BASE_URL}/{model_id}", json=payload)
        if resp.status_code >= 400:
            raise FalError(
                f"fal submit {model_id} failed ({resp.status_code}): {resp.text[:500]}"
            )
        body = resp.json()
    request_id = body.get("request_id")
    if not request_id:
        raise FalError(f"fal submit {model_id} response missing request_id: {body!r}")
    return request_id


async def _status(client: httpx.AsyncClient, model_id: str, request_id: str) -> dict[str, Any]:
    resp = await client.get(f"{QUEUE_BASE_URL}/{model_id}/requests/{request_id}/status")
    resp.raise_for_status()
    return resp.json()


async def _fetch_result(
    client: httpx.AsyncClient, model_id: str, request_id: str
) -> dict[str, Any]:
    resp = await client.get(f"{QUEUE_BASE_URL}/{model_id}/requests/{request_id}")
    resp.raise_for_status()
    return resp.json()


async def poll(
    model_id: str, request_id: str, *, timeout_sec: float = POLL_TIMEOUT_SEC
) -> dict[str, Any]:
    """Poll a queued fal request until it completes and return the result body."""
    _require_key()
    deadline = asyncio.get_event_loop().time() + timeout_sec
    async with _client() as client:
        while True:
            status_body = await _status(client, model_id, request_id)
            state = status_body.get("status")
            if state == "COMPLETED":
                return await _fetch_result(client, model_id, request_id)
            if state in ("ERROR", "FAILED"):
                raise FalError(f"fal job {request_id} failed: {status_body!r}")
            if asyncio.get_event_loop().time() >= deadline:
                raise FalError(f"fal job {request_id} timed out after {timeout_sec}s")
            await asyncio.sleep(POLL_INTERVAL_SEC)


async def run_queued(
    model_id: str, payload: dict[str, Any], *, timeout_sec: float = POLL_TIMEOUT_SEC
) -> dict[str, Any]:
    """submit + poll in one call — the common case for callers that don't
    need the intermediate request id."""
    request_id = await submit(model_id, payload)
    return await poll(model_id, request_id, timeout_sec=timeout_sec)


def extract_asset_url(result: dict[str, Any]) -> str:
    """Best-effort extraction of the first output asset URL from a fal
    response. Model families shape their output differently:
      - {"images": [{"url": ...}, ...]}   (flux family)
      - {"image": {"url": ...}}            (single-image edits)
      - {"video": {"url": ...}}            (image-to-video)
      - {"audio": {"url": ...}} / {"image_url"/"video_url"/"url": ...}
    Raises FalError if nothing recognizable is found.
    """
    images = result.get("images")
    if isinstance(images, list) and images:
        first = images[0]
        url = first.get("url") if isinstance(first, dict) else None
        if url:
            return url
    for key in ("image", "video", "audio"):
        val = result.get(key)
        if isinstance(val, dict) and val.get("url"):
            return val["url"]
    for key in ("image_url", "video_url", "audio_url", "url"):
        val = result.get(key)
        if isinstance(val, str) and val:
            return val
    raise FalError(f"could not find an asset URL in fal response: {result!r}")


async def download(url: str, out_path: Path) -> Path:
    """Download a fal result asset onto the artifacts volume. fal's result
    URLs expire, so this must run promptly after the call returns."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    async with _client() as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with out_path.open("wb") as fp:
                async for chunk in resp.aiter_bytes():
                    fp.write(chunk)
    return out_path
