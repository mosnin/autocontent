"""Domain -> Brief -> validated Ad Run plan.

Brand research is four independent Context.dev calls, so they run
concurrently and their failures are graded rather than pooled — Branda's
partial-failure policy, ported:

* brand AND homepage both failed -> `domain-unreachable`. Two independent
  probes missing means the site, not the vendor, is the problem.
* brand alone failed            -> `brand-unavailable`.
* products failed               -> `products-unavailable`. An Ad Run needs
  at least one fact-grounded Product; inventing one would put a made-up
  offering in front of the user as if it were theirs.
* styleguide failed             -> tolerated. Defaults produce a run that
  is on-message even when it is not perfectly on-palette.

Config is checked before any of it: with the feature off or Context.dev
unconfigured this raises `not-configured`, which the route turns into a
409. Nothing here ever reaches the researched site directly — every byte
comes through `services/context_dev.py`.
"""
from __future__ import annotations

import asyncio
from typing import Any

from ..config import settings
from ..logging import get_logger
from ..services import context_dev
from ..services.spend_context import SpendContext
from .brief import derive_summary_from_markdown, plan_concepts
from .colors import normalize_brand_color_hex, pick_brand_colors
from .domains import homepage_url, normalize_domain, normalize_public_http_url
from .policy import AD_RUN_LIMITS, product_max, product_min
from .schemas import AdRunPlan, BrandColor, Brief, Product, normalize_font_family

log = get_logger(__name__)

DEFAULT_MOOD = "modern, confident, premium"

_PRODUCT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "products": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["name", "description"],
            },
        }
    },
    "required": ["products"],
}

_PRODUCT_INSTRUCTIONS = (
    "List the distinct products or offerings this company actually sells, as "
    "named on its own site. Give each a short factual description drawn from "
    "the page. Do not invent products, bundles, or categories."
)


class AdRunPlanningError(RuntimeError):
    """A planning failure with a stable machine-readable code.

    The code is what the route maps to an HTTP status and what the run row
    stores, so it must stay stable even as messages change.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def is_configured() -> bool:
    """Both switches must be on: the feature flag, and the one vendor that
    supplies every fact a run is built from."""
    return bool(settings.ad_creative_enabled) and context_dev.is_configured()


def _text(value: Any, limit: int) -> str:
    return (value if isinstance(value, str) else "").strip()[:limit]


def _first_str(source: dict, *keys: str) -> str:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _logo_url(brand: dict) -> str | None:
    """Context.dev reports logos under several shapes across brands; take
    the first that survives public-URL normalization."""
    candidates: list[Any] = [brand.get("logoUrl"), brand.get("logo"), brand.get("icon")]
    logos = brand.get("logos")
    if isinstance(logos, list):
        for entry in logos:
            if isinstance(entry, str):
                candidates.append(entry)
            elif isinstance(entry, dict):
                candidates.extend([entry.get("url"), entry.get("src")])
    for candidate in candidates:
        if isinstance(candidate, str):
            normalized = normalize_public_http_url(candidate)
            if normalized:
                return normalized
    return None


def _palette(styleguide: dict) -> list[BrandColor]:
    """Every hex the styleguide reports, normalized and bounded.

    Kept as hex for the Gallery only — `pick_brand_colors` turns two of
    them into the phrases that actually reach a prompt.
    """
    raw = styleguide.get("colors")
    entries: list[Any] = []
    if isinstance(raw, list):
        entries = raw
    elif isinstance(raw, dict):
        for value in raw.values():
            entries.extend(value if isinstance(value, list) else [value])

    colors: list[BrandColor] = []
    seen: set[str] = set()
    for entry in entries:
        if isinstance(entry, str):
            hex_value, name = entry, ""
        elif isinstance(entry, dict):
            hex_value = _first_str(entry, "hex", "value", "color")
            name = _first_str(entry, "name", "label")
        else:
            continue
        normalized = normalize_brand_color_hex(hex_value)
        if normalized is None or normalized in seen:
            continue
        seen.add(normalized)
        colors.append(
            BrandColor(hex=normalized, name=name[: AD_RUN_LIMITS.color_name] or None)
        )
        if len(colors) >= AD_RUN_LIMITS.palette:
            break
    return colors


def _font_family(styleguide: dict) -> str | None:
    typography = styleguide.get("typography")
    candidates = [styleguide.get("fontFamily"), styleguide.get("font")]
    if isinstance(typography, dict):
        candidates += [
            typography.get("fontFamily"),
            typography.get("heading"),
            typography.get("headingFont"),
        ]
    for candidate in candidates:
        family = normalize_font_family(candidate)
        if family:
            return family
    return None


def build_brief(
    domain: str, brand: dict, markdown: str, styleguide: dict
) -> Brief:
    colors = _palette(styleguide)
    color_a, color_b = pick_brand_colors([c.hex for c in colors])
    brand_name = (
        _first_str(brand, "name", "title", "brandName")[: AD_RUN_LIMITS.brand_name] or domain
    )
    description = _text(
        _first_str(brand, "description", "summary") or _first_str(brand, "slogan", "tagline"),
        AD_RUN_LIMITS.description,
    )
    industry = _first_str(brand, "industry", "category")
    if not industry:
        industries = brand.get("industries")
        if isinstance(industries, list) and industries and isinstance(industries[0], str):
            industry = industries[0]

    return Brief(
        domain=domain,
        brand_name=brand_name,
        description=description,
        industry=industry[: AD_RUN_LIMITS.industry],
        summary=derive_summary_from_markdown(markdown),
        mood=_text(_first_str(styleguide, "mood", "tone"), AD_RUN_LIMITS.mood) or DEFAULT_MOOD,
        font_family=_font_family(styleguide),
        color_a=color_a,
        color_b=color_b,
        logo_url=_logo_url(brand),
        colors=colors,
    )


def parse_products(payload: Any) -> list[Product]:
    """Untrusted extraction output -> at most `product_max()` Products.

    Deduped case-insensitively by name: two rows for the same offering
    would give two Ad Slots the same subject, which the run contract
    forbids anyway.
    """
    rows: Any = payload
    if isinstance(payload, dict):
        rows = payload.get("products")
    if not isinstance(rows, list):
        return []

    products: list[Product] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = _text(row.get("name"), AD_RUN_LIMITS.product_name)
        description = _text(row.get("description"), AD_RUN_LIMITS.product_description)
        if not name or not description or name.lower() in seen:
            continue
        seen.add(name.lower())
        products.append(Product(name=name, description=description))
        if len(products) >= product_max():
            break
    return products


async def _research_products(domain: str) -> list[Product]:
    payload = await context_dev.extract_structured(
        homepage_url(domain), _PRODUCT_SCHEMA, instructions=_PRODUCT_INSTRUCTIONS
    )
    return parse_products(payload)


async def plan_ad_run(
    raw_domain: str, *, spend: SpendContext | None = None
) -> AdRunPlan:
    """The whole planning surface: a raw domain in, a validated plan out."""
    domain = normalize_domain(raw_domain)
    if domain is None:
        raise AdRunPlanningError(
            "invalid-domain", "enter a public website domain, e.g. stripe.com"
        )
    if not is_configured():
        raise AdRunPlanningError(
            "not-configured", "the ad creative studio is not enabled on this deployment"
        )

    brand_res, page_res, styleguide_res, products_res = await asyncio.gather(
        context_dev.retrieve_brand(domain),
        context_dev.scrape_markdown(homepage_url(domain)),
        context_dev.extract_styleguide(domain),
        _research_products(domain),
        return_exceptions=True,
    )

    brand_failed = isinstance(brand_res, BaseException)
    page_failed = isinstance(page_res, BaseException)
    if brand_failed and page_failed:
        raise AdRunPlanningError(
            "domain-unreachable", f"could not reach {domain}"
        ) from brand_res
    if brand_failed:
        raise AdRunPlanningError("brand-unavailable", f"no brand record for {domain}")
    if isinstance(products_res, BaseException):
        raise AdRunPlanningError(
            "products-unavailable", f"could not extract products from {domain}"
        )
    if len(products_res) < product_min():
        raise AdRunPlanningError(
            "products-unavailable",
            f"found {len(products_res)} products on {domain}; "
            f"an ad run needs at least {product_min()}",
        )

    if isinstance(styleguide_res, BaseException):
        # Tolerated: default mood, empty palette, fallback color phrases.
        log.info(
            "ad creative styleguide unavailable; using defaults",
            extra={"domain": domain, "error": str(styleguide_res)},
        )
        styleguide: dict = {}
    else:
        styleguide = styleguide_res if isinstance(styleguide_res, dict) else {}

    brief = build_brief(
        domain,
        brand_res if isinstance(brand_res, dict) else {},
        page_res if isinstance(page_res, str) else "",
        styleguide,
    )
    concepts = await plan_concepts(brief, products_res, spend=spend)
    return AdRunPlan(brief=brief, concepts=concepts)
