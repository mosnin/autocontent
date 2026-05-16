from __future__ import annotations

import json
from pathlib import Path

import pytest

from autocontent.services import music


def _make_track(library: Path, name: str, *, mood: str | None = None,
                duration_sec: float | None = None) -> Path:
    path = library / name
    path.write_bytes(b"\x00")
    meta: dict = {}
    if mood is not None:
        meta["mood"] = mood
    if duration_sec is not None:
        meta["duration_sec"] = duration_sec
    if meta:
        # Use the `<file>.json` sidecar form (e.g. song.mp3.json).
        path.with_suffix(path.suffix + ".json").write_text(json.dumps(meta))
    return path


async def test_local_library_hit_filters_by_mood(tmp_path: Path):
    lib = tmp_path / "music"
    lib.mkdir()
    _make_track(lib, "calm.mp3", mood="calm", duration_sec=120)
    chosen = _make_track(lib, "upbeat.mp3", mood="upbeat-educational", duration_sec=90)

    result = await music.pick_track(
        mood="upbeat-educational",
        target_duration_sec=60,
        library_dir=lib,
    )
    assert result == chosen


async def test_local_library_hit_without_sidecar_returns_any_track(tmp_path: Path):
    lib = tmp_path / "music"
    lib.mkdir()
    track = lib / "only.wav"
    track.write_bytes(b"\x00")

    result = await music.pick_track(
        mood="anything", target_duration_sec=45, library_dir=lib,
    )
    assert result == track


async def test_missing_library_raises(tmp_path: Path):
    missing = tmp_path / "does_not_exist"
    with pytest.raises(music.MusicNotFoundError, match="populate the music library"):
        await music.pick_track(
            mood="upbeat", target_duration_sec=30, library_dir=missing,
        )


async def test_empty_library_raises(tmp_path: Path):
    lib = tmp_path / "music"
    lib.mkdir()
    with pytest.raises(music.MusicNotFoundError):
        await music.pick_track(
            mood="upbeat", target_duration_sec=30, library_dir=lib,
        )


async def test_closest_duration_match_prefers_long_enough(tmp_path: Path):
    """Target 60s: 30s track is too short, 90s track is preferred (can be trimmed)."""
    lib = tmp_path / "music"
    lib.mkdir()
    _make_track(lib, "short.mp3", mood="upbeat", duration_sec=30)
    long_enough = _make_track(lib, "long.mp3", mood="upbeat", duration_sec=90)

    result = await music.pick_track(
        mood="upbeat", target_duration_sec=60, library_dir=lib,
    )
    assert result == long_enough


async def test_closest_duration_falls_back_to_longest_when_none_long_enough(tmp_path: Path):
    lib = tmp_path / "music"
    lib.mkdir()
    _make_track(lib, "a.mp3", mood="upbeat", duration_sec=20)
    longest = _make_track(lib, "b.mp3", mood="upbeat", duration_sec=40)

    result = await music.pick_track(
        mood="upbeat", target_duration_sec=120, library_dir=lib,
    )
    assert result == longest


async def test_mood_unmatched_falls_back_to_full_library(tmp_path: Path):
    """If no track tagged with the requested mood, we still return *something*."""
    lib = tmp_path / "music"
    lib.mkdir()
    only = _make_track(lib, "calm.mp3", mood="calm", duration_sec=90)

    result = await music.pick_track(
        mood="upbeat-educational", target_duration_sec=60, library_dir=lib,
    )
    assert result == only
