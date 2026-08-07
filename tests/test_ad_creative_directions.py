"""Catalog invariants + the twelve prompt implementations.

These are the checks that would otherwise only fail after six paid
renders: a direction without a prompt, a tier that can't fill its slots,
or a prompt that leaks a hex code into the artwork.
"""
from __future__ import annotations

import random

from marketer.adcreative import concepts, models
from marketer.adcreative.directions import (
    CREATIVE_DIRECTION_KEYS,
    CREATIVE_DIRECTIONS,
    direction_by_key,
    direction_label,
)
from marketer.adcreative.policy import AD_PRIMARY_MODEL_COUNT
from marketer.adcreative.schemas import Brief, ConceptSubject


def _brief(**overrides) -> Brief:
    base = dict(
        domain="stripe.com",
        brand_name="Stripe",
        description="Payments infrastructure for the internet.",
        industry="fintech",
        summary="Stripe builds economic infrastructure for the internet.",
        mood="modern, confident, premium",
        font_family="Sohne",
        color_a="vivid violet",
        color_b="deep navy",
        logo_url="https://stripe.com/logo.png",
        colors=[],
    )
    base.update(overrides)
    return Brief(**base)


def test_twelve_distinct_directions():
    assert len(CREATIVE_DIRECTIONS) == 12
    assert len(set(CREATIVE_DIRECTION_KEYS)) == 12


def test_every_direction_has_a_prompt_builder():
    assert set(concepts.PROMPT_BUILDERS) == set(CREATIVE_DIRECTION_KEYS)


def test_direction_lookup_and_label_fallback():
    assert direction_by_key("isometric").label == "Isometric World"
    assert direction_by_key("nope") is None
    # A key that has left the catalog still renders as something.
    assert direction_label("nope") == "nope"


def test_model_catalog_tiers_and_uniqueness():
    assert len(models.IMAGE_MODEL_IDS) == len(set(models.IMAGE_MODEL_IDS))
    assert len(models.image_models_by_tier("primary")) == AD_PRIMARY_MODEL_COUNT
    assert len(models.image_models_by_tier("secondary")) >= 3


def test_primary_models_can_carry_the_logo():
    """Company ads are the ones that show the wordmark, so every primary
    model must accept a reference image."""
    assert all(m.raster_logo for m in models.image_models_by_tier("primary"))


def test_every_model_is_priceable():
    for model in models.IMAGE_MODELS:
        assert models.image_price(model) > 0


def test_assignment_is_every_model_once_primary_first():
    assigned = models.assign_image_models(random.Random(7))
    assert sorted(assigned) == sorted(models.IMAGE_MODEL_IDS)
    for index, model_id in enumerate(assigned):
        expected = "primary" if index < AD_PRIMARY_MODEL_COUNT else "secondary"
        assert models.image_model_by_id(model_id).tier == expected


def test_prompts_carry_typography_spec_and_hard_rules():
    subject = ConceptSubject(kind="company")
    for key in CREATIVE_DIRECTION_KEYS:
        prompt = concepts.build_concept_prompt(
            key,
            concepts.PromptInput.from_brief(
                _brief(), subject=subject, headline="Move money", subheadline="Fast."
            ),
        )
        assert "TEXT IS THE #1 PRIORITY" in prompt
        assert concepts.HARD_RULES in prompt
        assert "1:1" in prompt
        assert '"Move money"' in prompt
        assert "Sohne" in prompt


def test_prompt_never_contains_a_hex_code():
    prompt = concepts.build_concept_prompt(
        "gradient_field",
        concepts.PromptInput.from_brief(
            _brief(), subject=ConceptSubject(kind="company"), headline="Hi", subheadline=""
        ),
    )
    assert "#" not in prompt
    assert "vivid violet" in prompt and "deep navy" in prompt


def test_product_prompt_names_the_product_and_forbids_drift():
    subject = ConceptSubject(kind="product", name="Radar", description="Fraud detection.")
    prompt = concepts.build_concept_prompt(
        "product_hero",
        concepts.PromptInput.from_brief(
            _brief(), subject=subject, headline="Stop fraud", subheadline="Automatically."
        ),
    )
    assert 'product "Radar"' in prompt
    assert "not a generic company-level metaphor" in prompt


def test_typographic_direction_includes_the_url():
    p = concepts.PromptInput.from_brief(
        _brief(), subject=ConceptSubject(kind="company"), headline="Hi", subheadline=""
    )
    assert '"stripe.com"' in concepts.build_concept_prompt("typographic", p)
    assert '"stripe.com"' not in concepts.build_concept_prompt("isometric", p)


def test_missing_font_family_falls_back_to_a_generic_sans():
    p = concepts.PromptInput.from_brief(
        _brief(font_family=None),
        subject=ConceptSubject(kind="company"),
        headline="Hi",
        subheadline="",
    )
    assert "geometric sans-serif" in concepts.build_concept_prompt("collage", p)


def test_unknown_direction_raises():
    p = concepts.PromptInput.from_brief(
        _brief(), subject=ConceptSubject(kind="company"), headline="Hi", subheadline=""
    )
    try:
        concepts.build_concept_prompt("no_such_direction", p)
    except ValueError as exc:
        assert "no_such_direction" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected ValueError")
