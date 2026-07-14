from decimal import Decimal

import pytest

from marketer.services.openai_pricing import (
    image_cost,
    tts_cost,
    whisper_cost,
)


def test_image_cost_per_quality():
    # Default size is the portrait 1024x1536 the pipeline renders — billed
    # at its own (higher) tier, NOT the square tier.
    assert image_cost("low") == Decimal("0.016")
    assert image_cost("medium") == Decimal("0.063")
    assert image_cost("high") == Decimal("0.25")
    assert image_cost("medium", n_images=6) == Decimal("0.378")
    # Square tier still available explicitly.
    assert image_cost("low", size="1024x1024") == Decimal("0.011")
    assert image_cost("medium", size="1024x1024") == Decimal("0.042")
    assert image_cost("high", size="1024x1024") == Decimal("0.167")


def test_image_cost_unknown_size_raises():
    import pytest
    with pytest.raises(ValueError):
        image_cost("medium", size="512x512")


def test_image_cost_unknown_quality_raises():
    with pytest.raises(ValueError):
        image_cost("ultra")


def test_tts_cost_per_minute_proportional():
    assert tts_cost(60.0) == Decimal("0.0150")
    assert tts_cost(30.0) == Decimal("0.0075")


def test_whisper_cost_per_minute_proportional():
    assert whisper_cost(60.0) == Decimal("0.0060")
    assert whisper_cost(120.0) == Decimal("0.0120")
