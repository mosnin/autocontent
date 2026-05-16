"""DALL-E 3 keyframe generation."""
from __future__ import annotations

from pathlib import Path


async def generate_keyframe(prompt: str, out_path: Path, size: str = "1024x1792") -> Path:
    """Generate a single keyframe via DALL-E 3 and save to `out_path`.

    TODO: implement with `openai.images.generate(model="dall-e-3", ...)`.
    Return the saved path. 9:16 short-form uses 1024x1792.
    """
    raise NotImplementedError
