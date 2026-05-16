"""Render word-level timings to an .ass subtitle file."""
from __future__ import annotations

from pathlib import Path


def words_to_ass(words: list[dict], out_path: Path, style: str = "tiktok-bold") -> Path:
    """Emit a karaoke-style ASS file — one or two words on screen, large,
    bottom-center, with each word popping in at its own start time.

    TODO: tune typography/anim per `style`.
    """
    raise NotImplementedError
