"""The Creative Direction catalog.

A Creative Direction is a named visual treatment with a dedicated prompt
implementation in `concepts.py`. This module holds only metadata: it is
the list the planning LLM chooses from and the labels the Gallery shows,
so it must stay importable without any provider configuration.

`best_for` is fed to the planner verbatim — it is the only steering the
model gets about which treatment suits which kind of brand.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CreativeDirection:
    key: str
    label: str
    best_for: str


CREATIVE_DIRECTIONS: tuple[CreativeDirection, ...] = (
    CreativeDirection(
        key="product_hero",
        label="Product Hero",
        best_for="physical products, hardware, tangible goods",
    ),
    CreativeDirection(
        key="isometric",
        label="Isometric World",
        best_for="B2B SaaS, developer tools, APIs, platforms",
    ),
    CreativeDirection(
        key="typographic",
        label="Type Poster",
        best_for="statement-driven brands, abstract products, bold positioning",
    ),
    CreativeDirection(
        key="macro_material",
        label="Macro Material",
        best_for="beauty, food, fashion, premium finishes and textures",
    ),
    CreativeDirection(
        key="gradient_field",
        label="Gradient Field",
        best_for="AI products, fintech, abstract or intangible services",
    ),
    CreativeDirection(
        key="editorial_spread",
        label="Editorial Spread",
        best_for="lifestyle, food and drink, travel, hospitality",
    ),
    CreativeDirection(
        key="sculptural_object",
        label="Sculptural Object",
        best_for="tech and AI brands with no physical product",
    ),
    CreativeDirection(
        key="data_viz",
        label="Chart as Art",
        best_for="analytics, BI, observability, data platforms",
    ),
    CreativeDirection(
        key="blueprint",
        label="Blueprint",
        best_for="engineering, hardware, infrastructure, industrial",
    ),
    CreativeDirection(
        key="retro_arcade",
        label="Retro Arcade",
        best_for="gaming, entertainment, playful consumer brands",
    ),
    CreativeDirection(
        key="monochrome_crop",
        label="Monochrome Crop",
        best_for="luxury, watches, minimalist premium brands",
    ),
    CreativeDirection(
        key="collage",
        label="Paper Collage",
        best_for="agencies, education, media, creative brands",
    ),
)

CREATIVE_DIRECTION_KEYS: tuple[str, ...] = tuple(d.key for d in CREATIVE_DIRECTIONS)

_BY_KEY = {d.key: d for d in CREATIVE_DIRECTIONS}


def direction_by_key(key: str) -> CreativeDirection | None:
    return _BY_KEY.get(key)


def direction_label(key: str) -> str:
    """Display label, falling back to the raw key so a Gallery row never
    renders blank for a direction that has since left the catalog."""
    direction = _BY_KEY.get(key)
    return direction.label if direction is not None else key
