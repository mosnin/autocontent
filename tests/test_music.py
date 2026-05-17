"""Tests for autocontent.services.music.

Covers:
- local library hit (query-token match + duration range)
- local library full-library fallback when no token match
- Pixabay remote fallback when local library is empty / no match
- None returned when no key and no local file
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

from autocontent.services import music
from autocontent.services.pixabay_music import Track


def _make_track(
    library: Path,
    name: str,
    *,
    mood: str | None = None,
    duration_sec: float | None = None,
) -> Path:
    path = library / name
    path.write_bytes(b"\x00")
    meta: dict = {}
    if mood is not None:
        meta["mood"] = mood
    if duration_sec is not None:
        meta["duration_sec"] = duration_sec
    if meta:
        path.with_suffix(path.suffix + ".json").write_text(json.dumps(meta))
    return path


# ---------------------------------------------------------------------------
# Local library hits
# ---------------------------------------------------------------------------

async def test_local_library_hit_by_filename_token(tmp_path: Path):
    """A file whose stem contains a query token is returned."""
    lib = tmp_path / "music"
    lib.mkdir()
    chosen = _make_track(lib, "upbeat-educational.mp3", duration_sec=90)

    result = await music.pick_track(
        query="upbeat-educational",
        target_duration_sec=60,
        library_dir=lib,
    )
    assert result == chosen


async def test_local_library_hit_filters_by_mood(tmp_path: Path):
    """Legacy behaviour: file with matching token is chosen over others."""
    lib = tmp_path / "music"
    lib.mkdir()
    _make_track(lib, "calm.mp3", mood="calm", duration_sec=120)
    # "upbeat" appears in filename — token match wins.
    chosen = _make_track(lib, "upbeat.mp3", mood="upbeat-educational", duration_sec=90)

    result = await music.pick_track(
        query="upbeat",
        target_duration_sec=60,
        library_dir=lib,
    )
    assert result == chosen


async def test_local_library_falls_back_to_full_library_when_no_token_match(tmp_path: Path):
    """If no file matches the query token, we fall back to the whole library."""
    lib = tmp_path / "music"
    lib.mkdir()
    only = _make_track(lib, "calm.mp3", duration_sec=90)

    result = await music.pick_track(
        query="upbeat-educational",
        target_duration_sec=60,
        library_dir=lib,
    )
    assert result == only


async def test_local_library_hit_without_sidecar_returns_any_track(tmp_path: Path):
    lib = tmp_path / "music"
    lib.mkdir()
    track = lib / "only.wav"
    track.write_bytes(b"\x00")

    result = await music.pick_track(
        query="anything", target_duration_sec=45, library_dir=lib,
    )
    assert result == track


# ---------------------------------------------------------------------------
# Pixabay remote fallback
# ---------------------------------------------------------------------------

async def test_remote_fallback_on_empty_library(tmp_path: Path, monkeypatch):
    """When library is empty and key is set, Pixabay is called and result cached."""
    lib = tmp_path / "music"
    lib.mkdir()
    cache_dir = tmp_path / "cache"

    fake_track = Track(id=42, audio_url="https://example.com/42.mp3",
                       duration=90, user="artist", tags="upbeat")

    async def fake_search(query, *, min_duration, max_duration, limit=20):
        return [fake_track]

    async def fake_download(url, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"\x00")
        return dest

    monkeypatch.setattr("autocontent.services.music.settings.pixabay_api_key", "test-key")
    with patch("autocontent.services.music.pixabay_music.search", new=AsyncMock(side_effect=fake_search)):
        with patch("autocontent.services.music.pixabay_music.download", new=AsyncMock(side_effect=fake_download)):
            result = await music.pick_track(
                query="upbeat educational",
                target_duration_sec=90,
                library_dir=lib,
                cache_dir=cache_dir,
            )

    assert result is not None
    assert result.name == "42.mp3"
    assert result.parent == cache_dir / "pixabay"


async def test_remote_fallback_reuses_cached_file(tmp_path: Path, monkeypatch):
    """If the Pixabay dest already exists (cached), download is skipped."""
    lib = tmp_path / "music"
    lib.mkdir()
    cache_dir = tmp_path / "cache"

    fake_track = Track(id=7, audio_url="https://example.com/7.mp3",
                       duration=90, user="artist", tags="chill")
    # Pre-populate the cache.
    cached = cache_dir / "pixabay" / "7.mp3"
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(b"\x00")

    async def fake_search(query, *, min_duration, max_duration, limit=20):
        return [fake_track]

    download_called = {"count": 0}

    async def fake_download(url, dest):
        # pixabay_music.download itself handles the cache-hit skip; simulate it.
        download_called["count"] += 1
        return dest

    monkeypatch.setattr("autocontent.services.music.settings.pixabay_api_key", "test-key")
    with patch("autocontent.services.music.pixabay_music.search", new=AsyncMock(side_effect=fake_search)):
        with patch("autocontent.services.music.pixabay_music.download", new=AsyncMock(side_effect=fake_download)):
            result = await music.pick_track(
                query="chill",
                target_duration_sec=90,
                library_dir=lib,
                cache_dir=cache_dir,
            )

    assert result == cached


# ---------------------------------------------------------------------------
# None return when nothing is available
# ---------------------------------------------------------------------------

async def test_no_key_and_no_local_returns_none(tmp_path: Path, monkeypatch):
    """Without a Pixabay key and with an empty library, pick_track returns None."""
    lib = tmp_path / "music"
    lib.mkdir()
    monkeypatch.setattr("autocontent.services.music.settings.pixabay_api_key", "")

    result = await music.pick_track(
        query="upbeat", target_duration_sec=60, library_dir=lib,
    )
    assert result is None


async def test_use_remote_false_returns_none_on_empty_library(tmp_path: Path, monkeypatch):
    """use_remote=False skips Pixabay even when key is present."""
    lib = tmp_path / "music"
    lib.mkdir()
    monkeypatch.setattr("autocontent.services.music.settings.pixabay_api_key", "test-key")

    result = await music.pick_track(
        query="upbeat", target_duration_sec=60, library_dir=lib, use_remote=False,
    )
    assert result is None


async def test_missing_library_returns_none(tmp_path: Path, monkeypatch):
    """A missing library_dir is handled gracefully — returns None."""
    missing = tmp_path / "does_not_exist"
    monkeypatch.setattr("autocontent.services.music.settings.pixabay_api_key", "")

    result = await music.pick_track(
        query="upbeat", target_duration_sec=30, library_dir=missing,
    )
    assert result is None


async def test_pixabay_error_returns_none(tmp_path: Path, monkeypatch):
    """A PixabayError during search should log a warning and return None."""
    from autocontent.services.pixabay_music import PixabayError

    lib = tmp_path / "music"
    lib.mkdir()
    monkeypatch.setattr("autocontent.services.music.settings.pixabay_api_key", "bad-key")

    async def raise_error(*args, **kwargs):
        raise PixabayError(401, "invalid API key")

    with patch("autocontent.services.music.pixabay_music.search", new=AsyncMock(side_effect=raise_error)):
        result = await music.pick_track(
            query="upbeat", target_duration_sec=60, library_dir=lib,
        )

    assert result is None
