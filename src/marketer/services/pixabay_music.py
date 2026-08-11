"""Pixabay Music API client.

Provides async search + download with on-disk caching. Authentication is
via a query-string `key` parameter — NOT a Bearer token.

API base: https://pixabay.com/api/music/
Response shape:
    {"total": N, "totalHits": N, "hits": [{"id": ..., "audio": "<url>", "duration": ..., ...}]}
"""
from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

import httpx

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

_BASE_URL = "https://pixabay.com/api/music/"
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=5.0)


class PixabayError(RuntimeError):
    """Raised for non-2xx responses from the Pixabay API."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        super().__init__(f"Pixabay API error {status_code}: {detail}")


@dataclass
class Track:
    id: int
    audio_url: str
    duration: int  # seconds
    user: str
    tags: str


async def search(
    query: str,
    *,
    min_duration: int,
    max_duration: int,
    limit: int = 20,
) -> list[Track]:
    """Search Pixabay Music and return a list of Track objects.

    Raises `PixabayError` on 401 (bad key), 429 (rate-limit), or 5xx.
    Returns an empty list if the API returns zero hits.
    """
    key = settings.pixabay_api_key
    if not key:
        raise PixabayError(0, "pixabay_api_key is not configured")

    params = {
        "key": key,
        "q": query,
        "min_duration": str(min_duration),
        "max_duration": str(max_duration),
        "per_page": str(min(limit, 200)),  # API cap is 200
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(_BASE_URL, params=params)

    if response.status_code == 401:
        raise PixabayError(401, "invalid API key")
    if response.status_code == 429:
        raise PixabayError(429, "rate limit exceeded")
    if response.status_code >= 500:
        raise PixabayError(response.status_code, "upstream server error")
    if not response.is_success:
        raise PixabayError(response.status_code, response.text[:200])

    data = response.json()
    hits = data.get("hits", [])
    tracks = [
        Track(
            id=hit["id"],
            audio_url=hit["audio"],
            duration=int(hit.get("duration", 0)),
            user=hit.get("user", ""),
            tags=hit.get("tags", ""),
        )
        for hit in hits
        if hit.get("audio")
    ]
    log.info(
        "pixabay.search",
        extra={"query": query, "total_hits": data.get("totalHits", 0), "returned": len(tracks)},
    )
    return tracks


async def download(track_url: str, dest: Path) -> Path:
    """Download `track_url` to `dest`, skipping if the file already exists.

    Downloads to a `.tmp` sibling first, then atomically renames to `dest`.
    Returns the final path.
    """
    if dest.exists():
        log.info("pixabay.download.cache_hit", extra={"dest": str(dest)})
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")

    log.info("pixabay.download.start", extra={"url": track_url, "dest": str(dest)})
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        async with client.stream("GET", track_url) as response:
            if not response.is_success:
                raise PixabayError(response.status_code, f"download failed: {track_url}")
            with tmp.open("wb") as fh:
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    fh.write(chunk)

    shutil.move(str(tmp), str(dest))
    log.info("pixabay.download.done", extra={"dest": str(dest)})
    return dest
