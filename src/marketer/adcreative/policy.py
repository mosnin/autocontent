"""Ad Run composition policy and the shared field limits.

Two kinds of number live here and they are deliberately different:

* `AD_RUN_LIMITS` is a *contract*. Every string that reaches an image
  prompt or the database is clamped to it, so a hostile or merely chatty
  extraction can never blow up a prompt or a column. It is frozen.
* The counts (`company_count`, `product_min`, ...) are *product knobs*
  read from settings at call time, so an operator can widen or narrow a
  run without a deploy — and so tests can monkeypatch them.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..config import settings


@dataclass(frozen=True, slots=True)
class AdRunLimits:
    """Field caps shared by the contract, the planner, and the repo."""

    domain: int = 253
    brand_name: int = 80
    description: int = 2000
    industry: int = 120
    summary: int = 480
    mood: int = 160
    font_family: int = 100
    prompt_color: int = 40
    logo_url: int = 2048
    palette: int = 8
    color_name: int = 80
    direction_key: int = 80
    image_model_id: int = 120
    headline: int = 60
    headline_words: int = 3
    subheadline: int = 120
    subheadline_words: int = 12
    product_name: int = 120
    product_description: int = 500


AD_RUN_LIMITS = AdRunLimits()

# The three Company Planned Concepts take the three primary-tier Image
# Models; anything else would let a company ad render on a model that
# cannot reproduce a raster logo.
AD_PRIMARY_MODEL_COUNT = 3

# Defaults, mirrored by config so the two can be compared at a glance.
DEFAULT_COMPANY_CONCEPT_COUNT = 3
DEFAULT_PRODUCT_CONCEPT_MIN = 1
DEFAULT_PRODUCT_CONCEPT_MAX = 3


def company_count() -> int:
    """Company Planned Concepts per Ad Run. Pinned to the number of
    primary Image Models: the two are the same three slots."""
    configured = int(settings.ad_creative_company_count)
    return max(1, min(configured, AD_PRIMARY_MODEL_COUNT))


def product_min() -> int:
    return max(1, int(settings.ad_creative_product_min))


def product_max() -> int:
    """Upper bound on Product Planned Concepts, never below the minimum."""
    return max(product_min(), int(settings.ad_creative_product_max))


def run_size_bounds() -> tuple[int, int]:
    """(min, max) Planned Concepts in one Ad Run."""
    company = company_count()
    return company + product_min(), company + product_max()


def fanout_limit() -> int:
    """Ad Slots rendered concurrently within one Ad Run."""
    return max(1, int(settings.ad_creative_fanout_limit))
