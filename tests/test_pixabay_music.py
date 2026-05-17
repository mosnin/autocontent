"""Unit tests for autocontent.services.pixabay_music.

All network I/O is mocked — no real HTTP calls are made.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from autocontent.services.pixabay_music import PixabayError, Track, download, search


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fake_response(status_code: int, json_body: dict | None = None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.is_success = 200 <= status_code < 300
    resp.text = text
    resp.json = MagicMock(return_value=json_body or {})
    return resp


def _search_payload(*hits: dict) -> dict:
    return {"total": len(hits), "totalHits": len(hits), "hits": list(hits)}


def _hit(id: int = 1, audio: str = "https://cdn.pixabay.com/1.mp3",
          duration: int = 90, user: str = "artist", tags: str = "upbeat") -> dict:
    return {"id": id, "audio": audio, "duration": duration, "user": user, "tags": tags}


# ---------------------------------------------------------------------------
# search()
# ---------------------------------------------------------------------------

async def test_search_returns_parsed_tracks(monkeypatch):
    monkeypatch.setattr("autocontent.services.pixabay_music.settings.pixabay_api_key", "k")
    payload = _search_payload(_hit(id=1, duration=90), _hit(id=2, duration=120))
    fake_resp = _fake_response(200, payload)

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=fake_resp)

        tracks = await search("upbeat", min_duration=60, max_duration=150)

    assert len(tracks) == 2
    assert isinstance(tracks[0], Track)
    assert tracks[0].id == 1
    assert tracks[0].duration == 90
    assert tracks[1].id == 2


async def test_search_empty_hits_returns_empty_list(monkeypatch):
    monkeypatch.setattr("autocontent.services.pixabay_music.settings.pixabay_api_key", "k")
    fake_resp = _fake_response(200, _search_payload())

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=fake_resp)

        tracks = await search("obscure-query", min_duration=30, max_duration=60)

    assert tracks == []


async def test_search_401_raises_pixabay_error(monkeypatch):
    monkeypatch.setattr("autocontent.services.pixabay_music.settings.pixabay_api_key", "bad")
    fake_resp = _fake_response(401)

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=fake_resp)

        with pytest.raises(PixabayError) as exc_info:
            await search("q", min_duration=0, max_duration=200)

    assert exc_info.value.status_code == 401
    assert "invalid API key" in str(exc_info.value)


async def test_search_429_raises_pixabay_error(monkeypatch):
    monkeypatch.setattr("autocontent.services.pixabay_music.settings.pixabay_api_key", "k")
    fake_resp = _fake_response(429)

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=fake_resp)

        with pytest.raises(PixabayError) as exc_info:
            await search("q", min_duration=0, max_duration=200)

    assert exc_info.value.status_code == 429


async def test_search_500_raises_pixabay_error(monkeypatch):
    monkeypatch.setattr("autocontent.services.pixabay_music.settings.pixabay_api_key", "k")
    fake_resp = _fake_response(503, text="Service Unavailable")

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=fake_resp)

        with pytest.raises(PixabayError) as exc_info:
            await search("q", min_duration=0, max_duration=200)

    assert exc_info.value.status_code == 503


async def test_search_no_key_raises(monkeypatch):
    monkeypatch.setattr("autocontent.services.pixabay_music.settings.pixabay_api_key", "")

    with pytest.raises(PixabayError) as exc_info:
        await search("q", min_duration=0, max_duration=200)

    assert exc_info.value.status_code == 0


async def test_search_skips_hits_without_audio(monkeypatch):
    monkeypatch.setattr("autocontent.services.pixabay_music.settings.pixabay_api_key", "k")
    payload = _search_payload(
        _hit(id=1),
        {"id": 2, "audio": "", "duration": 90, "user": "u", "tags": ""},  # empty audio
        {"id": 3, "duration": 90, "user": "u", "tags": ""},  # missing audio key
    )
    fake_resp = _fake_response(200, payload)

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=fake_resp)

        tracks = await search("q", min_duration=0, max_duration=200)

    assert len(tracks) == 1
    assert tracks[0].id == 1


# ---------------------------------------------------------------------------
# download()
# ---------------------------------------------------------------------------

async def test_download_writes_file(tmp_path: Path):
    dest = tmp_path / "pixabay" / "42.mp3"
    content = b"MP3_DATA" * 10

    async def aiter_bytes(chunk_size=65536):
        yield content

    resp = MagicMock()
    resp.is_success = True
    resp.status_code = 200
    resp.aiter_bytes = aiter_bytes

    class _StreamCtx:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        async def __aenter__(self):
            return resp
        async def __aexit__(self, *args):
            pass

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.stream = MagicMock(return_value=_StreamCtx())

        result = await download("https://example.com/42.mp3", dest)

    assert result == dest
    assert dest.exists()
    assert dest.read_bytes() == content


async def test_download_skips_if_exists(tmp_path: Path):
    dest = tmp_path / "42.mp3"
    dest.write_bytes(b"EXISTING")

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.stream = AsyncMock(
            side_effect=lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not download"))
        )
        result = await download("https://example.com/42.mp3", dest)

    assert result == dest
    assert dest.read_bytes() == b"EXISTING"


async def test_download_atomic_on_failure(tmp_path: Path):
    """If the download stream fails, no partial file is left at dest."""
    dest = tmp_path / "42.mp3"

    async def aiter_bytes_failing(chunk_size=65536):
        yield b"partial"
        raise OSError("disk full")

    resp = MagicMock()
    resp.is_success = True
    resp.aiter_bytes = aiter_bytes_failing

    class _StreamCtx:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        async def __aenter__(self):
            return resp
        async def __aexit__(self, *args):
            pass

    with patch("autocontent.services.pixabay_music.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.stream = MagicMock(return_value=_StreamCtx())

        with pytest.raises(OSError):
            await download("https://example.com/42.mp3", dest)

    # dest should not exist; the .tmp file may or may not exist depending on
    # where the error was thrown, but dest itself must be clean.
    assert not dest.exists()
