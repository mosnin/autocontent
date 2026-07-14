"""Background music selection.

Strategy: local-first, then Pixabay remote, then None (silent video).

1. Scan `library_dir` for audio files whose filename contains any token
   from `query` and whose sidecar-reported duration is within the
   acceptable range. If a match exists, return it immediately (cache hit).
2. If the local library has no match and `use_remote` is True and
   `settings.pixabay_api_key` is set, call the Pixabay Music API, pick
   the first result in the acceptable duration window, download it into
   `cache_dir` (or `library_dir` if `cache_dir` is None), and return the
   cached path. Subsequent calls for the same Pixabay track ID skip the
   download.
3. If neither source yields a track, log a warning and return `None`.
   The caller is responsible for handling missing music gracefully.

Acceptable duration window: [target - 30s, target + 60s].

Sidecar JSON shape (all keys optional):
    {"mood": "upbeat-educational", "duration_sec": 92.5, "license": "CC0"}
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from ..config import settings
from ..logging import get_logger
from . import pixabay_music

log = get_logger(__name__)

SUPPORTED_SUFFIXES = (".mp3", ".wav", ".m4a")

# How far outside the target duration we'll accept from any source.
_DURATION_SLACK_BEFORE = 30   # seconds shorter than target is OK
_DURATION_SLACK_AFTER = 60    # seconds longer than target is OK


class MusicNotFoundError(RuntimeError):
    """Kept for backward compatibility; pick_track now returns None instead."""


def _load_sidecar(track: Path) -> dict:
    for candidate in (track.with_suffix(track.suffix + ".json"), track.with_suffix(".json")):
        if candidate.exists():
            try:
                return json.loads(candidate.read_text())
            except json.JSONDecodeError:
                return {}
    return {}


def _duration_in_range(duration_sec: float | None, target: int) -> bool:
    if duration_sec is None:
        return True  # unknown duration: optimistically include
    low = target - _DURATION_SLACK_BEFORE
    high = target + _DURATION_SLACK_AFTER
    return low <= duration_sec <= high


def _query_tokens(query: str) -> list[str]:
    return [t.lower() for t in query.replace("-", " ").split() if t]


def _filename_matches_query(path: Path, tokens: list[str]) -> bool:
    stem = path.stem.lower().replace("-", " ").replace("_", " ")
    return any(t in stem for t in tokens)


def _scan_local(
    library_dir: Path,
    query: str,
    target_duration_sec: int,
) -> Path | None:
    """Return a local file matching query tokens + duration window, or None."""
    if not library_dir.exists() or not library_dir.is_dir():
        return None

    tokens = _query_tokens(query)
    candidates: list[Path] = []

    for path in sorted(library_dir.iterdir()):
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        # Accept if the filename contains any query token OR if no tokens (empty query).
        if tokens and not _filename_matches_query(path, tokens):
            continue
        meta = _load_sidecar(path)
        duration = None
        raw = meta.get("duration_sec")
        if raw is not None:
            try:
                duration = float(raw)
            except (TypeError, ValueError):
                duration = None
        if _duration_in_range(duration, target_duration_sec):
            candidates.append(path)

    if not candidates:
        # Second pass: ignore query tokens, just match duration (full library fallback).
        for path in sorted(library_dir.iterdir()):
            if path.suffix.lower() not in SUPPORTED_SUFFIXES:
                continue
            meta = _load_sidecar(path)
            duration = None
            raw = meta.get("duration_sec")
            if raw is not None:
                try:
                    duration = float(raw)
                except (TypeError, ValueError):
                    duration = None
            if _duration_in_range(duration, target_duration_sec):
                candidates.append(path)

    if candidates:
        return random.choice(candidates)
    return None


async def pick_track(
    *,
    query: str,
    target_duration_sec: int,
    library_dir: Path,
    cache_dir: Path | None = None,
    use_remote: bool = True,
) -> Path | None:
    """Select a music file for the given query and target duration.

    Returns a Path on success, or None if no track could be sourced.
    Never raises — the pipeline should keep going silently when music is
    unavailable.

    Args:
        query: Free-text description used both as a filename filter for the
            local library and as the Pixabay search query.
        target_duration_sec: Desired track length; acceptable window is
            [target - 30s, target + 60s].
        library_dir: Root of the local on-disk music library.
        cache_dir: Where to store Pixabay downloads. Falls back to
            `library_dir` when None.
        use_remote: When False, skip the Pixabay API entirely (useful in
            tests and offline environments).
    """
    # 1. Local library
    local = _scan_local(library_dir, query, target_duration_sec)
    if local is not None:
        log.info("music.cache_hit", extra={"path": str(local), "query": query})
        return local

    # 2. Pixabay remote
    if use_remote and settings.pixabay_api_key:
        dest_dir = cache_dir or library_dir
        try:
            min_dur = max(0, target_duration_sec - _DURATION_SLACK_BEFORE)
            max_dur = target_duration_sec + _DURATION_SLACK_AFTER
            tracks = await pixabay_music.search(
                query,
                min_duration=min_dur,
                max_duration=max_dur,
            )
            if tracks:
                chosen = tracks[0]
                dest = dest_dir / "pixabay" / f"{chosen.id}.mp3"
                path = await pixabay_music.download(chosen.audio_url, dest)
                log.info(
                    "music.downloaded",
                    extra={
                        "query": query,
                        "track_id": chosen.id,
                        "user": chosen.user,
                        "duration": chosen.duration,
                        "dest": str(path),
                    },
                )
                return path
            log.warning("music.no_remote_results", extra={"query": query})
        except pixabay_music.PixabayError as exc:
            log.warning("music.pixabay_error", extra={"error": str(exc), "query": query})

    # 3. No music available
    log.warning(
        "music.no_music",
        extra={
            "query": query,
            "library_dir": str(library_dir),
            "use_remote": use_remote,
            "has_key": bool(settings.pixabay_api_key),
        },
    )
    return None
