"""The Ad Run contract.

Everything that reaches a prompt, an image provider, or the database
passes through these models first. They are strict on purpose: the Brief
is assembled from third-party extraction output and LLM output, neither
of which is trustworthy, and a Planned Concept's fields are interpolated
directly into an image prompt.

`AdRunPlan` additionally enforces the run-level invariants Branda's
`decodeAdRunPlan` owned — distinct Creative Directions, distinct Image
Models, Company concepts before Product concepts, tier-correct model
placement — so an invalid run fails at planning time rather than after
six paid renders.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .directions import CREATIVE_DIRECTION_KEYS
from .models import IMAGE_MODEL_IDS, image_model_by_id
from .policy import AD_PRIMARY_MODEL_COUNT, AD_RUN_LIMITS, company_count, product_max, product_min

# Keeps an externally extracted font name bounded and inert inside an
# image prompt: letters, digits, and the punctuation real font families
# actually use. Anything else is dropped rather than sanitized, because a
# half-scrubbed family name is worse than no family name.
_SAFE_FONT_FAMILY = re.compile(r"^[^\W_][\w .,'&()+-]*$", re.UNICODE)


def normalize_font_family(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    family = value.strip()
    if (
        not family
        or len(family) > AD_RUN_LIMITS.font_family
        or not _SAFE_FONT_FAMILY.match(family)
    ):
        return None
    return family


def clamp_words(value: str, max_words: int) -> str:
    return " ".join(value.strip().split()[:max_words])


def limit_copy(value: str, *, words: int, characters: int) -> str:
    """Copy is clamped by words first, then characters: a headline that
    survives the word cap but blows the column is still truncated."""
    return clamp_words(value or "", words)[:characters].strip()


class BrandColor(BaseModel):
    hex: str = Field(max_length=7)
    name: str | None = Field(default=None, max_length=AD_RUN_LIMITS.color_name)


class Product(BaseModel):
    """A distinct offering fact-grounded in the Brand's public site."""

    name: str = Field(min_length=1, max_length=AD_RUN_LIMITS.product_name)
    description: str = Field(min_length=1, max_length=AD_RUN_LIMITS.product_description)


class ConceptSubject(BaseModel):
    """The exact thing one ad promotes: the company, or one Product."""

    kind: Literal["company", "product"]
    name: str = Field(default="", max_length=AD_RUN_LIMITS.product_name)
    description: str = Field(default="", max_length=AD_RUN_LIMITS.product_description)

    @model_validator(mode="after")
    def _product_needs_facts(self) -> ConceptSubject:
        if self.kind == "product" and not (self.name.strip() and self.description.strip()):
            raise ValueError("a product subject needs a name and a description")
        if self.kind == "company" and (self.name or self.description):
            raise ValueError("a company subject carries no product facts")
        return self


class Brief(BaseModel):
    """Normalized Brand facts + descriptive visual attributes for one run.

    `color_a`/`color_b` are already plain-English phrases; `colors` keeps
    the raw palette for the UI. Hex never crosses into a prompt.
    """

    domain: str = Field(min_length=1, max_length=AD_RUN_LIMITS.domain)
    brand_name: str = Field(min_length=1, max_length=AD_RUN_LIMITS.brand_name)
    description: str = Field(default="", max_length=AD_RUN_LIMITS.description)
    industry: str = Field(default="", max_length=AD_RUN_LIMITS.industry)
    summary: str = Field(default="", max_length=AD_RUN_LIMITS.summary)
    mood: str = Field(min_length=1, max_length=AD_RUN_LIMITS.mood)
    font_family: str | None = Field(default=None, max_length=AD_RUN_LIMITS.font_family)
    color_a: str = Field(min_length=1, max_length=AD_RUN_LIMITS.prompt_color)
    color_b: str = Field(min_length=1, max_length=AD_RUN_LIMITS.prompt_color)
    logo_url: str | None = Field(default=None, max_length=AD_RUN_LIMITS.logo_url)
    colors: list[BrandColor] = Field(default_factory=list, max_length=AD_RUN_LIMITS.palette)

    @field_validator("font_family")
    @classmethod
    def _inert_font(cls, value: str | None) -> str | None:
        return normalize_font_family(value)

    @field_validator("color_a", "color_b")
    @classmethod
    def _no_hex_in_prompt_colors(cls, value: str) -> str:
        # Belt and braces around `colors.describe_color`: if a hex code
        # ever leaks this far it would be printed into the artwork.
        if value.strip().startswith("#"):
            raise ValueError("prompt colors must be plain-English phrases, not hex")
        return value


class PlannedConcept(BaseModel):
    """One Creative Direction + copy + subject + Image Model."""

    key: str = Field(min_length=1, max_length=AD_RUN_LIMITS.direction_key)
    model: str = Field(min_length=1, max_length=AD_RUN_LIMITS.image_model_id)
    subject: ConceptSubject
    headline: str = Field(min_length=1, max_length=AD_RUN_LIMITS.headline)
    subheadline: str = Field(default="", max_length=AD_RUN_LIMITS.subheadline)

    @field_validator("key")
    @classmethod
    def _known_direction(cls, value: str) -> str:
        if value not in CREATIVE_DIRECTION_KEYS:
            raise ValueError(f"unknown Creative Direction {value!r}")
        return value

    @field_validator("model")
    @classmethod
    def _known_model(cls, value: str) -> str:
        if value not in IMAGE_MODEL_IDS:
            raise ValueError(f"unknown Image Model {value!r}")
        return value

    @model_validator(mode="after")
    def _copy_stays_poster_sized(self) -> PlannedConcept:
        if len(self.headline.split()) > AD_RUN_LIMITS.headline_words:
            raise ValueError("headline contains too many words")
        if len(self.subheadline.split()) > AD_RUN_LIMITS.subheadline_words:
            raise ValueError("subheadline contains too many words")
        return self


class AdRunPlan(BaseModel):
    """One Brief plus its ordered Planned Concepts."""

    brief: Brief
    concepts: list[PlannedConcept]

    @model_validator(mode="after")
    def _run_is_well_formed(self) -> AdRunPlan:
        company = company_count()
        low, high = company + product_min(), company + product_max()
        if not low <= len(self.concepts) <= high:
            raise ValueError(
                f"an Ad Run must contain between {low} and {high} Planned Concepts"
            )

        keys = [c.key for c in self.concepts]
        if len(set(keys)) != len(keys):
            raise ValueError("an Ad Run must contain distinct Creative Directions")
        models = [c.model for c in self.concepts]
        if len(set(models)) != len(models):
            raise ValueError("an Ad Run must contain distinct Image Models")

        head = self.concepts[:company]
        tail = self.concepts[company:]
        if any(c.subject.kind != "company" for c in head) or any(
            c.subject.kind != "product" for c in tail
        ):
            raise ValueError(
                f"an Ad Run must place {company} Company concepts before its Product concepts"
            )

        product_names = [c.subject.name.lower() for c in tail]
        if len(set(product_names)) != len(product_names):
            raise ValueError("an Ad Run must advertise distinct Products")

        for index, concept in enumerate(self.concepts):
            expected = "primary" if index < AD_PRIMARY_MODEL_COUNT else "secondary"
            model = image_model_by_id(concept.model)
            if model is None or model.tier != expected:
                raise ValueError(f"{expected} Image Model required in slot {index + 1}")
        return self
