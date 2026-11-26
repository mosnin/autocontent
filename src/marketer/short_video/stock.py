"""Stock footage from Pexels and Pixabay (official APIs).

Adapted from MoneyPrinterTurbo's ``app/services/material.py``
(``search_videos_pexels``, ``search_videos_pixabay``; MIT, Copyright (c) 2024
Harry): the response parsing and the "smallest rendition that still fills the
canvas" choice. Rewritten for httpx, our settings, typed clips with licence
and attribution, a 24-hour search cache and a host allowlist for downloads.

Keys stay server-side (``MARKETER_PEXELS_API_KEY``, ``MARKETER_PIXABAY_API_KEY``).
A provider without a key is skipped, never an error. Search results are cached
for 24 hours (Pixabay's API terms ask clients to cache; it also saves quota),
and clips are downloaded to our own storage: neither provider allows
hotlinking their files into a product.
"""
from __future__ import annotations

import math
import shutil
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from ..config import settings
from ..logging import get_logger
from .models import Aspect, StockClip

log = get_logger(__name__)

PEXELS_URL = "https://api.pexels.com/videos/search"
PIXABAY_URL = "https://pixabay.com/api/videos/"

LICENCES = {
    "pexels": ("Pexels License", "https://www.pexels.com/license/"),
    "pixabay": ("Pixabay Content License", "https://pixabay.com/service/license-summary/"),
}

# Downloads only from the providers' own file hosts (and never follow a
# redirect elsewhere): a search result is third-party data.
DOWNLOAD_HOSTS = {
    "pexels": ("videos.pexels.com", "player.vimeo.com", "vod-progressive.akamaized.net"),
    "pixabay": ("cdn.pixabay.com",),
}

MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024
CACHE_TTL_SEC = 24 * 3600
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=5.0)

CANVAS: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080)}
# Footage below this still looks fine scaled up on a phone; requiring full
# 1080p would empty most searches.
MIN_SHORT_SIDE = 540


class StockError(RuntimeError):
    pass


class SearchCache(Protocol):
    async def get(self, provider: str, query: str, orientation: str) -> list[dict] | None: ...
    async def put(self, provider: str, query: str, orientation: str, results: list[dict]) -> None: ...


class MemoryCache:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str, str], list[dict]] = {}

    async def get(self, provider, query, orientation):
        return self.rows.get((provider, query, orientation))

    async def put(self, provider, query, orientation, results):
        self.rows[(provider, query, orientation)] = results


def orientation_for(aspect: Aspect) -> str:
    return {"9:16": "portrait", "16:9": "landscape", "1:1": "square"}[aspect]


def configured_sources() -> list[str]:
    out = []
    if settings.pexels_api_key:
        out.append("pexels")
    if settings.pixabay_api_key:
        out.append("pixabay")
    return out


def _matches(w: int, h: int, aspect: Aspect) -> bool:
    """Orientation match; square output crops either orientation."""
    if aspect == "1:1":
        return True
    return (h > w) if aspect == "9:16" else (w > h)


def _fills(w: int, h: int, aspect: Aspect) -> bool:
    return min(w, h) >= MIN_SHORT_SIDE and _matches(w, h, aspect)


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def _safe_url(v: Any) -> str:
    if isinstance(v, str) and v.startswith("https://"):
        return v[:500]
    return ""


def parse_pexels(payload: Any, *, query: str, aspect: Aspect, min_duration: float) -> list[StockClip]:
    licence, licence_url = LICENCES["pexels"]
    out: list[StockClip] = []
    videos = payload.get("videos") if isinstance(payload, dict) else None
    for v in videos or []:
        if not isinstance(v, dict):
            continue
        duration = _num(v.get("duration"))
        if duration is None or duration < min_duration:
            continue
        best: tuple[int, dict, int, int] | None = None
        for f in v.get("video_files") or []:
            if not isinstance(f, dict) or f.get("file_type", "video/mp4") != "video/mp4":
                continue
            try:
                w, h = int(f.get("width")), int(f.get("height"))
            except (TypeError, ValueError):
                continue
            link = _safe_url(f.get("link"))
            if not link or not _fills(w, h, aspect):
                continue
            if best is None or w * h < best[0]:
                best = (w * h, f, w, h)
        if best is None:
            continue
        _, f, w, h = best
        user = v.get("user") if isinstance(v.get("user"), dict) else {}
        out.append(StockClip(
            provider="pexels", provider_id=str(v.get("id", "")), download_url=_safe_url(f.get("link")),
            page_url=_safe_url(v.get("url")), width=w, height=h, duration_sec=duration,
            creator=str(user.get("name") or "")[:120], creator_url=_safe_url(user.get("url")),
            licence=licence, licence_url=licence_url, query=query,
        ))
    return out


def parse_pixabay(payload: Any, *, query: str, aspect: Aspect, min_duration: float) -> list[StockClip]:
    licence, licence_url = LICENCES["pixabay"]
    out: list[StockClip] = []
    hits = payload.get("hits") if isinstance(payload, dict) else None
    for v in hits or []:
        if not isinstance(v, dict):
            continue
        duration = _num(v.get("duration"))
        if duration is None or duration < min_duration:
            continue
        files = v.get("videos") if isinstance(v.get("videos"), dict) else {}
        best: tuple[int, dict, int, int] | None = None
        for f in files.values():
            if not isinstance(f, dict):
                continue
            try:
                w, h = int(f.get("width")), int(f.get("height"))
            except (TypeError, ValueError):
                continue
            url = _safe_url(f.get("url"))
            if not url or not _fills(w, h, aspect):
                continue
            if best is None or w * h < best[0]:
                best = (w * h, f, w, h)
        if best is None:
            continue
        _, f, w, h = best
        user = str(v.get("user") or "")[:120]
        uid = v.get("user_id")
        out.append(StockClip(
            provider="pixabay", provider_id=str(v.get("id", "")), download_url=_safe_url(f.get("url")),
            page_url=_safe_url(v.get("pageURL")), width=w, height=h, duration_sec=duration,
            creator=user,
            creator_url=f"https://pixabay.com/users/{user}-{uid}/" if user and uid else "",
            licence=licence, licence_url=licence_url, query=query,
        ))
    return out


async def _get(client: httpx.AsyncClient, url: str, *, params: dict, headers: dict) -> Any:
    resp = await client.get(url, params=params, headers=headers)
    if resp.status_code == 429:
        raise StockError("rate limited")
    if resp.status_code in (401, 403):
        raise StockError("key refused")
    if not resp.is_success:
        raise StockError(f"status {resp.status_code}")
    try:
        return resp.json()
    except ValueError as e:
        raise StockError("not JSON") from e


async def search_provider(
    provider: str, query: str, *, aspect: Aspect, min_duration: float = 3.0,
    client: httpx.AsyncClient, cache: SearchCache | None = None,
) -> list[StockClip]:
    """One provider, one term. Errors are logged and yield no clips: footage
    from the other provider or the next term still makes the video."""
    orientation = orientation_for(aspect)
    if cache is not None:
        cached = await cache.get(provider, query, orientation)
        if cached is not None:
            return [StockClip.model_validate(c) for c in cached if c.get("duration_sec", 0) >= min_duration]
    try:
        if provider == "pexels":
            if not settings.pexels_api_key:
                return []
            params: dict[str, Any] = {"query": query, "per_page": 20}
            if orientation != "square":
                params["orientation"] = orientation
            payload = await _get(client, PEXELS_URL, params=params, headers={"Authorization": settings.pexels_api_key})
            clips = parse_pexels(payload, query=query, aspect=aspect, min_duration=0)
        elif provider == "pixabay":
            if not settings.pixabay_api_key:
                return []
            params = {"q": query, "video_type": "film", "per_page": 30, "safesearch": "true", "key": settings.pixabay_api_key}
            payload = await _get(client, PIXABAY_URL, params=params, headers={})
            clips = parse_pixabay(payload, query=query, aspect=aspect, min_duration=0)
        else:
            return []
    except (StockError, httpx.HTTPError) as e:
        # Never the URL: Pixabay's carries the key.
        log.warning("stock.search_failed", extra={"provider": provider, "error": type(e).__name__, "detail": str(e)[:80]})
        return []
    if cache is not None:
        try:
            await cache.put(provider, query, orientation, [c.model_dump() for c in clips])
        except Exception:  # noqa: BLE001 - a cache is never a reason a video fails
            log.warning("stock.cache_put_failed", exc_info=True)
    return [c for c in clips if c.duration_sec >= min_duration]


async def search(
    terms: Iterable[tuple[int, str]], *, sources: Iterable[str], aspect: Aspect,
    min_duration: float = 3.0, client: httpx.AsyncClient | None = None,
    cache: SearchCache | None = None, per_term: int = 4,
) -> list[StockClip]:
    """Clips for every (segment, term), up to ``per_term`` each, alternating
    providers, deduplicated by provider id."""
    owns = client is None
    client = client or httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False)
    try:
        seen: set[tuple[str, str]] = set()
        out: list[StockClip] = []
        srcs = [s for s in sources if s in ("pexels", "pixabay")]
        for segment, term in terms:
            per_provider = [await search_provider(p, term, aspect=aspect, min_duration=min_duration, client=client, cache=cache) for p in srcs]
            taken = 0
            for row in _interleave(per_provider):
                key = (row.provider, row.provider_id)
                if key in seen:
                    continue
                seen.add(key)
                out.append(row.model_copy(update={"segment": segment, "query": term}))
                taken += 1
                if taken >= per_term:
                    break
        return out
    finally:
        if owns:
            await client.aclose()


def _interleave(lists: list[list[StockClip]]) -> list[StockClip]:
    out: list[StockClip] = []
    for i in range(max((len(x) for x in lists), default=0)):
        for x in lists:
            if i < len(x):
                out.append(x[i])
    return out


def download_allowed(clip: StockClip) -> bool:
    host = (urlparse(clip.download_url).hostname or "").lower()
    if urlparse(clip.download_url).scheme != "https":
        return False
    return any(host == h or host.endswith("." + h) for h in DOWNLOAD_HOSTS.get(clip.provider, ()))


def cache_path(clip: StockClip, root: Path) -> Path:
    safe_id = "".join(ch for ch in clip.provider_id if ch.isalnum())[:40] or "x"
    return root / clip.provider / f"{safe_id}_{clip.width}x{clip.height}.mp4"


async def download(clip: StockClip, root: Path, *, client: httpx.AsyncClient | None = None) -> Path:
    """Fetch a clip into the shared footage cache (one file per provider id
    and rendition). Refuses hosts outside the allowlist and oversize files."""
    if not download_allowed(clip):
        raise StockError(f"download host not allowed for {clip.provider}")
    dest = cache_path(clip, root)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    owns = client is None
    client = client or httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False)
    try:
        async with client.stream("GET", clip.download_url) as resp:
            if not resp.is_success:
                raise StockError(f"download status {resp.status_code}")
            size = 0
            with tmp.open("wb") as fh:
                async for chunk in resp.aiter_bytes(65536):
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES:
                        raise StockError("clip too large")
                    fh.write(chunk)
        shutil.move(str(tmp), str(dest))
        return dest
    finally:
        tmp.unlink(missing_ok=True)
        if owns:
            await client.aclose()
