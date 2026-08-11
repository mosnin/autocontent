"""Path helpers for Modal volume layout.

Layout (inside the artifacts volume):
  /artifacts/<job_id>/
    script.json
    keyframes/scene_<i>.png
    clips/scene_<i>.mp4
    audio/voiceover.wav
    audio/music.mp3
    captions/words.json
    captions/subs.ass
    output/final.mp4
    output/thumbnail.jpg
    job.json
"""
from __future__ import annotations

from pathlib import Path

from ..config import settings


def job_root(job_id: str) -> Path:
    return Path(settings.artifacts_dir) / job_id


def ensure_layout(job_id: str) -> Path:
    root = job_root(job_id)
    for sub in ("keyframes", "clips", "audio", "captions", "output"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    return root
