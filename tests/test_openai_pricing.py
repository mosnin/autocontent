from decimal import Decimal

import pytest

from marketer.services.openai_pricing import (
    image_cost,
    tts_cost,
    whisper_cost,
)


def test_image_cost_per_quality():
    assert image_cost("low") == Decimal("0.011")
    assert image_cost("medium") == Decimal("0.042")
    assert image_cost("high") == Decimal("0.167")
    assert image_cost("medium", n_images=6) == Decimal("0.252")


def test_image_cost_unknown_quality_raises():
    with pytest.raises(ValueError):
        image_cost("ultra")


def test_tts_cost_per_minute_proportional():
    assert tts_cost(60.0) == Decimal("0.0150")
    assert tts_cost(30.0) == Decimal("0.0075")


def test_whisper_cost_per_minute_proportional():
    assert whisper_cost(60.0) == Decimal("0.0060")
    assert whisper_cost(120.0) == Decimal("0.0120")
