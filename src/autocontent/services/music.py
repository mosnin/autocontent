"""Background music selection.

Strategy: local-first, with a pluggable remote fetch hook. We scan the
on-disk library (`library_dir`) for tracks, optionally filter by mood
using a sidecar JSON file (`<track>.json`), and return the closest-
duration match. If the library is missing or empty, `_fetch_remote` is
called as a last resort; if that also returns nothing, we raise
`MusicNotFoundError`.

Sidecar JSON shape (all keys optional):
    {"mood": "upbeat-educational", "duration_sec": 92.5, "license": "CC0"}

Duration-match rule: prefer the shortest track whose duration is >=
target_duration_sec (we can trim a longer track to fit). If no track is
long enough, pick the longest available (it will need to be looped).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

SUPPORTED_SUFFIXES = (".mp3", ".wav", ".m4a")


class MusicNotFoundError(RuntimeError):
    """No suitable music track could be located locally or remotely."""


@dataclass
class _Track:
    path: Path
    mood: str | None
    duration_sec: float | None
    license: str | None


def _load_sidecar(track: Path) -> dict:
    sidecar = track.with_suffix(track.suffix + ".json")
    if sidecar.exists():
        try:
            return json.loads(sidecar.read_text())
        except json.JSONDecodeError:
            return {}
    # Also accept "<stem>.json" (e.g. song.mp3 + song.json) for convenience.
    alt = track.with_suffix(".json")
    if alt.exists():
        try:
            return json.loads(alt.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def _scan_library(library_dir: Path) -> list[_Track]:
    if not library_dir.exists() or not library_dir.is_dir():
        return []
    tracks: list[_Track] = []
    for path in sorted(library_dir.iterdir()):
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        meta = _load_sidecar(path)
        duration = meta.get("duration_sec")
        try:
            duration_f = float(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration_f = None
        tracks.append(
            _Track(
                path=path,
                mood=meta.get("mood"),
                duration_sec=duration_f,
                license=meta.get("license"),
            )
        )
    return tracks


def _filter_by_mood(tracks: list[_Track], mood: str) -> list[_Track]:
    """Filter to tracks whose sidecar mood matches `mood` (case-insensitive).

    Tracks without a sidecar mood tag are left in as fallbacks only when
    no mood-tagged track matches; the caller handles that.
    """
    mood_lower = mood.lower().strip()
    matches = [t for t in tracks if t.mood and t.mood.lower().strip() == mood_lower]
    return matches


def _pick_closest_duration(tracks: list[_Track], target_duration_sec: float) -> _Track:
    """From a non-empty list, pick the closest-duration match.

    Rule: prefer the shortest track with duration >= target (it can be
    trimmed). If none qualify, pick the longest (it will be looped).
    Tracks without known duration are tried last, in scan order.
    """
    with_duration = [t for t in tracks if t.duration_sec is not None]
    without_duration = [t for t in tracks if t.duration_sec is None]

    long_enough = [t for t in with_duration if (t.duration_sec or 0.0) >= target_duration_sec]
    if long_enough:
        return min(long_enough, key=lambda t: t.duration_sec or 0.0)
    if with_duration:
        return max(with_duration, key=lambda t: t.duration_sec or 0.0)
    return without_duration[0]


async def _fetch_remote(mood: str, target_duration_sec: float) -> Path | None:
    """Placeholder for a future remote-fetch integration.

    TODO: wire this to a free music source (Pixabay Music / FMA /
    Incompetech mirror). Today returns None; the function exists so
    swapping in a real implementation is a small, contained change. A
    real implementation should download into the assets volume's music
    dir, write a sidecar JSON alongside, and return the new path.
    """
    _ = (mood, target_duration_sec)
    return None


async def pick_track(
    mood: str,
    target_duration_sec: float,
    library_dir: Path,
) -> Path:
    """Select a music file matching `mood` and `target_duration_sec`.

    Search order:
        1. Local library at `library_dir`, filtered by mood sidecar.
        2. Local library, ignoring mood (fallback).
        3. `_fetch_remote(...)` (currently always None).

    Raises `MusicNotFoundError` if no track can be located.
    """
    tracks = _scan_library(library_dir)

    if tracks:
        mood_matches = _filter_by_mood(tracks, mood)
        chosen_pool = mood_matches or tracks
        return _pick_closest_duration(chosen_pool, target_duration_sec).path

    remote = await _fetch_remote(mood, target_duration_sec)
    if remote is not None:
        return remote

    raise MusicNotFoundError(
        f"No tracks in {library_dir}; populate the music library or wire a fetch source"
    )
