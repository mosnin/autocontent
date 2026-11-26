# Portions adapted from Open SEO (https://github.com/maximemarsal/open-seo),
# lib/services/wordpress.ts, MIT License, Copyright (c) 2025 Maxime Marsal.
# See THIRD_PARTY_NOTICES.md. Adapted: the Yoast meta keys, the RankMath
# equivalents and the check that WordPress did not silently demote a
# "publish" to a draft. Rewritten in Python with an SSRF guard, pinned
# connections, no redirects and no featured-image re-upload.
"""WordPress REST client for publishing articles.

Talks to ``{site}/wp-json/wp/v2`` with an application password (Basic auth).
The site URL is a customer-supplied URL fetched by our servers, so every
request:

- requires https, no credentials in the URL, no query or fragment;
- resolves the host and refuses any non-public address (``services/ssrf.py``)
  at connect time, then connects to the address it checked (no second DNS
  lookup, so DNS rebinding cannot swap in an internal host);
- never follows redirects (a 3xx could point anywhere);
- has a timeout.

Errors: ``WordPressRefused`` is a definite failure (bad credentials, missing
capability, validation, SSRF refusal): nothing was published. HTTP 5xx and
read timeouts propagate as ``httpx`` errors, which the rails classify as an
unknown outcome (the post may exist).

The application password is passed in by the caller after it opens the
sealed value; this module never stores or logs it.
"""
from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from . import ssrf

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
USER_AGENT = "Marketer-WordPress/1"
SEO_PLUGINS = ("yoast", "rankmath", "none")

Resolver = Callable[[str], tuple[bool, str, str | None]]


class WordPressRefused(Exception):
    """A definite failure: nothing was published by this request."""

    def __init__(self, message: str, *, status: int | None = None, post_id: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.post_id = post_id


def normalize_site_url(url: str) -> str:
    """``https://host[:port][/path]`` without a trailing slash, or raises
    ``WordPressRefused``. Syntax only; the address check happens per request."""
    raw = (url or "").strip()
    try:
        p = urlparse(raw)
        host = p.hostname
        p.port  # noqa: B018 - raises on a bad port
    except ValueError as exc:
        raise WordPressRefused("That site address isn't a valid URL.") from exc
    if p.scheme != "https":
        raise WordPressRefused("Use the site's https:// address.")
    if not host:
        raise WordPressRefused("That site address has no host.")
    if p.username is not None or p.password is not None:
        raise WordPressRefused("Leave the username and password out of the site address.")
    if p.query or p.fragment or p.params:
        raise WordPressRefused("Use the site's address without ?query or #fragment.")
    path = p.path.rstrip("/")
    if path.endswith("/wp-admin") or "/wp-json" in path:
        path = path.split("/wp-admin")[0].split("/wp-json")[0]
    out = f"https://{p.netloc.lower()}{path}"
    if len(out) > 300:
        raise WordPressRefused("That site address is too long.")
    return out


@dataclass(frozen=True)
class WordPressSite:
    site_url: str
    username: str
    app_password: str = field(repr=False)
    seo_plugin: str = "yoast"


@dataclass(frozen=True)
class PostInput:
    title: str
    html: str
    slug: str
    excerpt: str
    meta_title: str
    meta_description: str
    focus_keyword: str
    secondary_keywords: tuple[str, ...] = ()
    live: bool = False


@dataclass(frozen=True)
class PostResult:
    post_id: int
    link: str
    status: str
    edit_url: str


def seo_meta(plugin: str, post: PostInput) -> dict[str, str]:
    """The SEO plugin's post meta. WordPress stores only meta keys the site
    registered for the REST API; unregistered keys are ignored by WordPress."""
    if plugin == "yoast":
        return {
            "_yoast_wpseo_title": post.meta_title,
            "_yoast_wpseo_metadesc": post.meta_description,
            "_yoast_wpseo_focuskw": post.focus_keyword,
        }
    if plugin == "rankmath":
        return {
            "rank_math_title": post.meta_title,
            "rank_math_description": post.meta_description,
            # RankMath takes the focus keyword first, then the others, comma-separated.
            "rank_math_focus_keyword": ",".join([post.focus_keyword, *post.secondary_keywords]),
        }
    return {}


class WordPressClient:
    def __init__(
        self, site: WordPressSite, *, transport: httpx.AsyncBaseTransport | None = None,
        resolver: Resolver | None = None,
    ) -> None:
        self.site = WordPressSite(
            site_url=normalize_site_url(site.site_url), username=site.username,
            app_password=site.app_password.replace(" ", ""), seo_plugin=site.seo_plugin,
        )
        self._transport = transport
        self._resolver = resolver or ssrf.resolve_public_url

    def _auth(self) -> str:
        token = base64.b64encode(f"{self.site.username}:{self.site.app_password}".encode()).decode()
        return f"Basic {token}"

    async def _request(self, method: str, path: str, *, json: dict[str, Any] | None = None) -> Any:
        url = f"{self.site.site_url}/wp-json/wp/v2{path}"
        ok, reason, address = await asyncio.to_thread(self._resolver, url)
        if not ok or address is None:
            raise WordPressRefused(f"We won't connect to that site address: {reason}.")
        target, host_header, server_name = ssrf.pinned_target(url, address)
        headers = {
            "host": host_header, "authorization": self._auth(),
            "user-agent": USER_AGENT, "accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, transport=self._transport) as client:
            resp = await client.request(
                method, target, json=json, headers=headers,
                extensions={"sni_hostname": server_name},
            )
        if 300 <= resp.status_code < 400:
            raise WordPressRefused("The site answered with a redirect. Use its final https:// address.", status=resp.status_code)
        if resp.status_code in (401, 403):
            raise WordPressRefused(
                "WordPress refused the username or application password, or the user can't do this.",
                status=resp.status_code,
            )
        if resp.status_code == 404:
            raise WordPressRefused("The WordPress REST API wasn't found at that address.", status=404)
        if 400 <= resp.status_code < 500:
            raise WordPressRefused(f"WordPress rejected the request ({resp.status_code}): {_wp_message(resp)}", status=resp.status_code)
        resp.raise_for_status()  # 5xx: unknown outcome for writes
        try:
            return resp.json()
        except ValueError as exc:
            raise WordPressRefused("The site didn't answer like a WordPress REST API.", status=resp.status_code) from exc

    async def verify(self) -> dict[str, Any]:
        """Check the credentials and whether the user may publish."""
        me = await self._request("GET", "/users/me?context=edit")
        if not isinstance(me, dict) or "id" not in me:
            raise WordPressRefused("The site didn't answer like a WordPress REST API.")
        caps = me.get("capabilities") or {}
        return {
            "user_id": me.get("id"),
            "name": str(me.get("name") or "")[:120],
            "can_publish": bool(isinstance(caps, dict) and caps.get("publish_posts")),
        }

    async def publish(self, post: PostInput, *, existing_id: int | None = None) -> PostResult:
        """Create (or update, with ``existing_id``) the post. A draft stays a
        draft on WordPress; ``live`` publishes it."""
        body: dict[str, Any] = {
            "title": post.title,
            "content": post.html,
            "status": "publish" if post.live else "draft",
            "slug": post.slug,
            "excerpt": post.excerpt,
        }
        meta = seo_meta(self.site.seo_plugin, post)
        if meta:
            body["meta"] = meta
        path = f"/posts/{int(existing_id)}" if existing_id else "/posts"
        data = await self._request("POST", path, json=body)
        try:
            post_id = int(data["id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise WordPressRefused("WordPress didn't return the post id.") from exc
        status = str(data.get("status") or "")
        if post.live and status != "publish":
            # Typical when the application-password user lacks publish_posts
            # (Author or Contributor role): WordPress keeps a draft quietly.
            raise WordPressRefused(
                f"WordPress kept the post as “{status or 'unknown'}” instead of publishing it. "
                "The user needs the Editor or Administrator role.",
                post_id=post_id,
            )
        link = data.get("link") if isinstance(data.get("link"), str) else ""
        return PostResult(
            post_id=post_id, link=link if link.startswith("https://") else "", status=status,
            edit_url=f"{self.site.site_url}/wp-admin/post.php?post={post_id}&action=edit",
        )


def _wp_message(resp: httpx.Response) -> str:
    try:
        msg = resp.json().get("message")
    except (ValueError, AttributeError):
        msg = None
    return str(msg or "no details")[:200]
