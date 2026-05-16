"""Grok Imagine (xAI) animation client.

Takes a keyframe + motion prompt and returns an animated short clip.
"""
from __future__ import annotations

from pathlib import Path


async def animate(keyframe_path: Path, motion_prompt: str, out_path: Path,
                  duration_sec: float = 5.0) -> Path:
    """Submit a keyframe + motion prompt to Grok Imagine, poll for the result, save mp4.

    TODO: implement against xAI's image-to-video endpoint. Likely flow:
      1. POST job (multipart with image + prompt + duration)
      2. Poll job status until ready
      3. Download mp4 to `out_path`
    """
    raise NotImplementedError
