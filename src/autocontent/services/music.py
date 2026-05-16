"""Background music selection.

Strategy: maintain a small curated, license-cleared library on a Modal volume
keyed by mood/tempo tags. Pick a track that matches the script's emotional
arc, then loop/trim to the target duration.
"""
from __future__ import annotations

from pathlib import Path


def pick_track(mood: str, target_duration_sec: float, library_dir: Path) -> Path:
    """Pick a music file from the on-disk library matching `mood`.

    TODO: scan library_dir, read sidecar JSON metadata (mood, bpm, duration,
    license), filter, and return a path. Fall back to a neutral default.
    """
    raise NotImplementedError
