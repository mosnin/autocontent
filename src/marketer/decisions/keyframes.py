"""Keyframes for the video QA check on garbled on-screen text (point 9).

The decision model reads PNG or JPEG images placed in the state as
``image_url`` parts with a base64 data URL. It only accepts frames inside a
size window (see docs/decisions/openrouter-contract.md), so every frame is
scaled here before it is sent.

Sampling is best-effort: an unreadable file, a missing ffmpeg or an extreme
aspect ratio yields no frames, and the verify pass then runs on text alone,
exactly as it does without this module.
"""
from __future__ import annotations

import asyncio
import base64
import os
import subprocess
from pathlib import Path
from typing import Any

from ..logging import get_logger

log = get_logger(__name__)

# How many frames one verify call carries, and where in the video they sit.
MAX_FRAMES = 3
POSITIONS: tuple[float, ...] = (0.15, 0.5, 0.85)

# The model's window: each side 256..1568 px and 78,400..2,458,624 px in all.
# Frames are scaled so the long side is LONG_SIDE, which keeps any frame up
# to 4:1 inside the window with room to spare.
LONG_SIDE = 1024
MIN_SIDE = 256
MAX_SIDE = 1568
MIN_PIXELS = 78_400
MAX_PIXELS = 2_458_624

_FFMPEG_TIMEOUT_S = 20


def enabled() -> bool:
    """MARKETER_DECISIONS_KEYFRAMES=off drops the image check and keeps the
    text checks (image input is an early feature of the model)."""
    return os.environ.get("MARKETER_DECISIONS_KEYFRAMES", "").strip().lower() not in (
        "off", "0", "false", "no",
    )


def target_size(width: int, height: int) -> tuple[int, int] | None:
    """The size a ``width`` x ``height`` frame is scaled to, or None when no
    size inside the model's window keeps its aspect ratio."""
    if width <= 0 or height <= 0:
        return None
    scale = LONG_SIDE / max(width, height)
    # Even sides: the JPEG encoder's chroma subsampling needs them.
    w = max(2, round(width * scale / 2) * 2)
    h = max(2, round(height * scale / 2) * 2)
    if min(w, h) < MIN_SIDE or max(w, h) > MAX_SIDE or not MIN_PIXELS <= w * h <= MAX_PIXELS:
        return None
    return w, h


def _probe(path: Path) -> tuple[int, int, float]:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        check=True, capture_output=True, text=True, timeout=_FFMPEG_TIMEOUT_S,
    ).stdout.split()
    return int(out[0]), int(out[1]), float(out[2])


def _frame(path: Path, at_s: float, size: tuple[int, int]) -> bytes:
    return subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-ss", f"{at_s:.3f}", "-i", str(path),
            "-frames:v", "1", "-vf", f"scale={size[0]}:{size[1]}",
            "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "5", "-",
        ],
        check=True, capture_output=True, timeout=_FFMPEG_TIMEOUT_S,
    ).stdout


def sample(path: Path | str, *, frames: int = MAX_FRAMES) -> list[bytes]:
    """Up to ``frames`` JPEG keyframes from the video, scaled into the
    model's window. Empty on any failure."""
    try:
        path = Path(path)
        width, height, duration = _probe(path)
        size = target_size(width, height)
        if size is None or duration <= 0:
            return []
        out: list[bytes] = []
        for pos in POSITIONS[: max(0, min(frames, MAX_FRAMES))]:
            jpeg = _frame(path, duration * pos, size)
            if jpeg.startswith(b"\xff\xd8"):
                out.append(jpeg)
        return out
    except Exception as e:  # noqa: BLE001 — no frames is a valid outcome
        log.warning("keyframe sampling failed", extra={"error": type(e).__name__})
        return []


async def sample_async(path: Path | str, *, frames: int = MAX_FRAMES) -> list[bytes]:
    return await asyncio.to_thread(sample, path, frames=frames)


def image_part(image: bytes) -> dict[str, Any] | None:
    """The state part for one PNG or JPEG image, or None for anything else
    (the model rejects other formats, which would fail the whole call)."""
    if image.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif image.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    else:
        return None
    data = base64.b64encode(image).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}}


def image_parts(images: list[bytes] | None) -> list[dict[str, Any]]:
    parts = [image_part(i) for i in (images or [])[:MAX_FRAMES]]
    return [p for p in parts if p is not None]
