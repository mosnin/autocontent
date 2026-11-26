"""Unsplash photos for article covers.

The access key stays on the server (``MARKETER_UNSPLASH_ACCESS_KEY``); the
browser only ever sees photo URLs and attribution.

Unsplash API guidelines we follow:

- **Hotlink** the image from ``images.unsplash.com`` (we never re-host it).
- **Attribute** the photographer and Unsplash, linking both with
  ``utm_source=<app>&utm_medium=referral``. ``attribution`` builds exactly that
  and it is stored with the cover, so every place that shows the cover can
  show the credit.
- **Trigger the download endpoint** when a photo is chosen
  (``links.download_location``), which is how Unsplash counts a use.

A photo chosen by a person is re-read from Unsplash by id on the server; a
URL sent by the browser is never stored.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from pydantic import BaseModel

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)

API = "https://api.unsplash.com"
UTM = urlencode({"utm_source": "marketer", "utm_medium": "referral"})
TIMEOUT = httpx.Timeout(15.0, connect=5.0)
_IMAGE_HOSTS = {"images.unsplash.com", "plus.unsplash.com"}
_PAGE_HOSTS = {"unsplash.com"}


class UnsplashDisabled(RuntimeError):
    pass


class UnsplashPhoto(BaseModel):
    id: str
    url: str            # the image to hotlink (regular size)
    thumb_url: str
    alt: str = ""
    width: int | None = None
    height: int | None = None
    author_name: str
    author_url: str     # photographer profile, with UTM
    photo_url: str      # the photo's page on Unsplash, with UTM
    unsplash_url: str = f"https://unsplash.com/?{UTM}"
    download_location: str = ""


def enabled() -> bool:
    return bool(settings.unsplash_access_key)


def _host_ok(url: Any, hosts: set[str]) -> bool:
    if not isinstance(url, str):
        return False
    try:
        p = urlparse(url)
    except ValueError:
        return False
    return p.scheme == "https" and (p.hostname or "") in hosts


def _with_utm(url: str) -> str:
    return f"{url}{'&' if '?' in url else '?'}{UTM}"


def parse_photo(raw: dict[str, Any]) -> UnsplashPhoto | None:
    """One API photo object, or None when it lacks what we must show."""
    try:
        urls = raw.get("urls") or {}
        user = raw.get("user") or {}
        links = raw.get("links") or {}
        url = urls.get("regular") or urls.get("full")
        thumb = urls.get("small") or urls.get("thumb") or url
        author_page = (user.get("links") or {}).get("html")
        photo_page = links.get("html")
        name = (user.get("name") or user.get("username") or "").strip()
        if not (raw.get("id") and name and _host_ok(url, _IMAGE_HOSTS) and _host_ok(thumb, _IMAGE_HOSTS)):
            return None
        if not (_host_ok(author_page, _PAGE_HOSTS) and _host_ok(photo_page, _PAGE_HOSTS)):
            return None
        download = links.get("download_location") or ""
        if download and not _host_ok(download, {"api.unsplash.com"}):
            download = ""
        return UnsplashPhoto(
            id=str(raw["id"])[:64],
            url=url, thumb_url=thumb,
            alt=(raw.get("alt_description") or raw.get("description") or "")[:300],
            width=raw.get("width"), height=raw.get("height"),
            author_name=name[:120],
            author_url=_with_utm(author_page), photo_url=_with_utm(photo_page),
            download_location=download,
        )
    except (AttributeError, TypeError, ValueError):
        return None


def attribution(photo: UnsplashPhoto) -> str:
    return f"Photo by {photo.author_name} on Unsplash"


def _headers() -> dict[str, str]:
    if not enabled():
        raise UnsplashDisabled("Unsplash is not configured")
    return {"authorization": f"Client-ID {settings.unsplash_access_key}", "accept-version": "v1"}


async def search(query: str, *, per_page: int = 12, client: httpx.AsyncClient | None = None) -> list[UnsplashPhoto]:
    headers = _headers()
    params = {
        "query": query[:100], "per_page": max(1, min(per_page, 30)),
        "orientation": "landscape", "content_filter": "high",
    }
    own = client is None
    http = client or httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)
    try:
        resp = await http.get(f"{API}/search/photos", params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    finally:
        if own:
            await http.aclose()
    out = [parse_photo(r) for r in (data.get("results") or []) if isinstance(r, dict)]
    return [p for p in out if p is not None]


async def get_photo(photo_id: str, *, client: httpx.AsyncClient | None = None) -> UnsplashPhoto | None:
    headers = _headers()
    if not photo_id or len(photo_id) > 64 or not all(c.isalnum() or c in "-_" for c in photo_id):
        return None
    own = client is None
    http = client or httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)
    try:
        resp = await http.get(f"{API}/photos/{photo_id}", headers=headers)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        raw = resp.json()
    finally:
        if own:
            await http.aclose()
    return parse_photo(raw) if isinstance(raw, dict) else None


async def track_download(photo: UnsplashPhoto, *, client: httpx.AsyncClient | None = None) -> None:
    """Tell Unsplash the photo was used. Best effort: a failure is logged."""
    if not photo.download_location:
        return
    try:
        headers = _headers()
        own = client is None
        http = client or httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)
        try:
            await http.get(photo.download_location, headers=headers)
        finally:
            if own:
                await http.aclose()
    except Exception as exc:  # noqa: BLE001
        log.warning("unsplash download tracking failed", extra={"error": type(exc).__name__})


def cover_record(photo: UnsplashPhoto) -> dict[str, Any]:
    """What ``articles.cover_image`` stores."""
    return {
        "source": "unsplash",
        "id": photo.id,
        "url": photo.url,
        "thumb_url": photo.thumb_url,
        "alt": photo.alt,
        "width": photo.width,
        "height": photo.height,
        "author_name": photo.author_name,
        "author_url": photo.author_url,
        "photo_url": photo.photo_url,
        "unsplash_url": photo.unsplash_url,
        "attribution": attribution(photo),
    }
