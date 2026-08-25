"""Context.dev adapter — brand intelligence and web extraction.

One vendor, four operations, and every feature built on them (the ad
creative studio, the SEO auditor) goes through this seam:

- `retrieve_brand`      brand name/description/slogan/industry/logo
- `scrape_markdown`     a page as clean Markdown (main content only)
- `scrape_html`         a page's rendered HTML, after client-side JS lands
- `extract_styleguide`  accent/background/text palette + Google Font links
- `extract_structured`  JSON-Schema-shaped facts crawled from a site

Design notes that matter to callers:

*   **Never fetch the audited/researched site directly.** Everything flows
    through Context.dev, which owns rendering, robots compliance, and
    extraction. That keeps us off the hook for SSRF, headless browsers,
    and crawl etiquette, so no caller should "just fetch it" as a fallback.
*   **`ContextDevUnavailable` is the only expected failure.** Missing key,
    HTTP error, timeout, and malformed JSON all normalize to it, so callers
    decide the policy (degrade, 409, partial result) instead of catching
    `httpx` and `ValueError` at every site.
*   **Nothing here retries.** Retry/backoff policy belongs to the caller,
    which knows whether a stage already cost money.
"""
from __future__ import annotations

from typing import Any

import httpx

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)


class ContextDevUnavailable(RuntimeError):
    """Context.dev is unconfigured, unreachable, or returned nonsense.

    `status` carries the upstream HTTP status when there was one, so a
    caller can distinguish "this domain 404s" from "the vendor is down".
    """

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def is_configured() -> bool:
    return bool(settings.context_dev_api_key.strip())


def _require_key() -> str:
    key = settings.context_dev_api_key.strip()
    if not key:
        raise ContextDevUnavailable("CONTEXT_DEV_API_KEY is not set")
    return key


async def _post(path: str, payload: dict[str, Any], *, timeout: float | None = None) -> dict:
    """POST one Context.dev operation and return its decoded JSON body."""
    key = _require_key()
    url = f"{settings.context_dev_base_url.rstrip('/')}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(
            timeout=timeout or settings.context_dev_timeout_sec
        ) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "authorization": f"Bearer {key}",
                    "content-type": "application/json",
                },
            )
            resp.raise_for_status()
            body = resp.json()
    except httpx.HTTPStatusError as exc:
        raise ContextDevUnavailable(
            f"context.dev {path} failed: {exc.response.status_code}",
            status=exc.response.status_code,
        ) from exc
    except httpx.HTTPError as exc:
        raise ContextDevUnavailable(f"context.dev {path} unreachable: {exc}") from exc
    except ValueError as exc:  # non-JSON body
        raise ContextDevUnavailable(f"context.dev {path} returned non-JSON") from exc

    if not isinstance(body, dict):
        raise ContextDevUnavailable(f"context.dev {path} returned a non-object body")
    return body


# ── operations ────────────────────────────────────────────────────────────


async def retrieve_brand(domain: str) -> dict:
    """Brand record for a domain: title, description, slogan, logos,
    industries. Returned verbatim under the `brand` key — normalization is
    the caller's job, because the ad planner and the auditor want different
    slices of it."""
    body = await _post("v1/brand/retrieve", {"type": "by_domain", "domain": domain})
    brand = body.get("brand")
    return brand if isinstance(brand, dict) else {}


async def scrape_markdown(
    url: str, *, main_content_only: bool = True, include_links: bool = True
) -> str:
    """A page as Markdown. Doubles as the reachability probe: callers treat
    a raise here as "couldn't reach this site"."""
    body = await _post(
        "v1/web/scrape/markdown",
        {
            "url": url,
            "useMainContentOnly": main_content_only,
            "includeLinks": include_links,
            "includeImages": False,
        },
    )
    markdown = body.get("markdown")
    return markdown if isinstance(markdown, str) else ""


async def scrape_html(url: str, *, wait_for_ms: int | None = None) -> str:
    """A page's rendered HTML. `wait_for_ms` gives client-side JSON-LD
    injectors (Next.js head, Wix, Shopify apps) time to land before the
    snapshot — without it, schema-in-JS sites look schema-less."""
    body = await _post(
        "v1/web/scrape/html",
        {
            "url": url,
            "waitForMs": (
                settings.seo_audit_html_wait_ms if wait_for_ms is None else wait_for_ms
            ),
        },
    )
    html = body.get("html")
    return html if isinstance(html, str) else ""


async def extract_styleguide(domain: str) -> dict:
    """The site's visual styleguide: colors, typography, font links."""
    body = await _post("v1/web/styleguide/extract", {"domain": domain})
    styleguide = body.get("styleguide")
    return styleguide if isinstance(styleguide, dict) else {}


async def extract_structured(
    url: str,
    schema: dict,
    *,
    instructions: str = "",
    fact_check: bool = True,
    max_pages: int = 5,
    max_depth: int = 2,
    stop_after_ms: int = 45_000,
) -> Any:
    """Crawl `url` and return data shaped by `schema` (a JSON Schema).

    The response is untrusted model output that merely *claims* to match
    the schema — always re-validate it locally before use.
    """
    payload: dict[str, Any] = {
        "url": url,
        "schema": schema,
        "factCheck": fact_check,
        "maxPages": max_pages,
        "maxDepth": max_depth,
        "stopAfterMs": stop_after_ms,
    }
    if instructions:
        payload["instructions"] = instructions
    body = await _post(
        "v1/web/extract", payload, timeout=max(settings.context_dev_timeout_sec, 90.0)
    )
    return body.get("data")
