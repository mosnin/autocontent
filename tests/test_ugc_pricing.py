"""Pinned per-model UGC render pricing."""
from __future__ import annotations

from decimal import Decimal

import pytest

from marketer.ugc import catalog, pricing
from marketer.ugc.pricing import UgcPricingError, cost_basis, estimate_cost, usd_per_second


def test_every_catalog_model_has_a_pinned_price_for_every_resolution():
    # An unpriced model/resolution would submit an unmetered paid render.
    for model in catalog.list_models():
        if model.resolutions:
            for res in model.resolutions:
                assert usd_per_second(model, res) > 0
        else:
            assert usd_per_second(model) > 0


def test_cost_scales_with_duration():
    assert estimate_cost("grok-video", duration=6, resolution="480p") == Decimal("0.3000")
    assert estimate_cost("grok-video", duration=12, resolution="480p") == Decimal("0.6000")


def test_grok_720p_doubles_480p_matching_the_source_credit_step():
    # Source: duration * (10 if 720p else 5) -> a clean 2x.
    lo = usd_per_second(catalog.get_model("grok-video"), "480p")
    hi = usd_per_second(catalog.get_model("grok-video"), "720p")
    assert hi == lo * 2


def test_veo_resolution_premiums_match_the_source_credit_ratios():
    # Source: 500 / 650 / 740 credits per second for 720p / 1080p / 4k.
    veo = catalog.get_model("veo-3-1")
    base = usd_per_second(veo, "720p")
    assert usd_per_second(veo, "1080p") == (base * Decimal(650) / Decimal(500))
    assert usd_per_second(veo, "4k") == (base * Decimal(740) / Decimal(500))


def test_veo_fixed_8s_render_cost():
    assert estimate_cost("veo-3-1", duration=8, resolution="720p") == Decimal("3.2000")
    assert estimate_cost("veo-3-1", duration=8, resolution="4k") == Decimal("4.7360")


def test_models_without_a_resolution_knob_price_flat():
    assert estimate_cost("happy-horse", duration=5) == Decimal("0.3000")
    assert estimate_cost("seedance-2", duration=5) == Decimal("0.5000")


def test_resolution_is_ignored_for_models_that_have_none():
    # Defence in depth: the catalog already rejects a stray resolution, so
    # pricing must not fall through to "no pinned price" if one arrives.
    assert estimate_cost("happy-horse", duration=5, resolution="1080p") == Decimal("0.3000")


def test_unknown_resolution_on_a_priced_model_fails_closed():
    with pytest.raises(UgcPricingError):
        usd_per_second(catalog.get_model("veo-3-1"), "8k")


def test_unpriced_model_fails_closed_rather_than_costing_zero(monkeypatch):
    monkeypatch.setitem(pricing.USD_PER_SECOND, "grok-video", {})
    with pytest.raises(UgcPricingError):
        estimate_cost("grok-video", duration=6, resolution="480p")


def test_cost_basis_shape_for_the_ui():
    grok = cost_basis(catalog.get_model("grok-video"))
    assert grok["unit"] == "usd_per_second"
    assert set(grok["by_resolution"]) == {"480p", "720p"}

    horse = cost_basis(catalog.get_model("happy-horse"))
    assert horse == {"unit": "usd_per_second", "flat": "0.06"}


def test_quantization_never_loses_money_to_float_drift():
    cost = estimate_cost("veo-3-1", duration=8, resolution="1080p")
    assert cost == Decimal("4.1600")
    assert cost.as_tuple().exponent == -4
