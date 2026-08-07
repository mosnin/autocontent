"""UGC model catalog + per-model parameter capability validation.

Pure functions — no DB, no provider, no network.
"""
from __future__ import annotations

import pytest

from marketer.ugc import catalog
from marketer.ugc.catalog import UgcValidationError, validate_params

ALL_IDS = {"grok-video", "veo-3-1", "happy-horse", "seedance-2"}


def test_catalog_ports_the_four_source_models():
    assert {m.id for m in catalog.list_models()} == ALL_IDS


def test_every_model_declares_a_reachable_endpoint_and_defaults():
    for model in catalog.list_models():
        assert model.endpoint and not model.endpoint.startswith("/")
        assert model.default_aspect_ratio in model.aspect_ratios
        assert model.allows_duration(model.default_duration)
        if model.resolutions:
            assert model.default_resolution in model.resolutions
        else:
            assert model.default_resolution == ""
        if model.modes:
            assert model.default_mode in model.modes
        else:
            assert model.default_mode == ""


def test_every_model_defaults_to_vertical():
    # This product's UGC lane exists to make 9:16 ads; the source's
    # landscape defaults are deliberately overridden.
    for model in catalog.list_models():
        assert model.default_aspect_ratio == "9:16"
        assert "9:16" in model.aspect_ratios


def test_unknown_model_id_is_rejected():
    with pytest.raises(UgcValidationError) as exc:
        validate_params("sora-9000")
    assert "unknown model" in str(exc.value)


def test_defaults_are_filled_in_when_nothing_is_supplied():
    assert validate_params("grok-video") == {
        "aspect_ratio": "9:16",
        "duration": 6,
        "resolution": "480p",
        "mode": "normal",
    }


def test_models_without_a_knob_omit_it_from_the_wire_payload():
    # Happy Horse / Seedance have no resolution or mode parameter, so
    # neither key may appear in the submit body.
    for model_id in ("happy-horse", "seedance-2"):
        params = validate_params(model_id)
        assert "resolution" not in params
        assert "mode" not in params


def test_aspect_ratio_outside_the_model_set_is_rejected():
    # 21:9 is a Seedance-only ratio.
    validate_params("seedance-2", aspect_ratio="21:9")
    with pytest.raises(UgcValidationError, match="aspect ratio"):
        validate_params("veo-3-1", aspect_ratio="21:9")


def test_fixed_duration_model_rejects_anything_but_its_option():
    assert validate_params("veo-3-1", duration=8)["duration"] == 8
    with pytest.raises(UgcValidationError, match="duration"):
        validate_params("veo-3-1", duration=7)


def test_range_duration_is_enforced_at_both_ends():
    assert validate_params("grok-video", duration=6)["duration"] == 6
    assert validate_params("grok-video", duration=30)["duration"] == 30
    with pytest.raises(UgcValidationError, match="duration"):
        validate_params("grok-video", duration=5)
    with pytest.raises(UgcValidationError, match="duration"):
        validate_params("grok-video", duration=31)


def test_unsupported_resolution_is_rejected():
    assert validate_params("veo-3-1", resolution="4k")["resolution"] == "4k"
    with pytest.raises(UgcValidationError, match="resolution"):
        validate_params("veo-3-1", resolution="8k")


def test_resolution_on_a_model_without_one_is_rejected_not_ignored():
    with pytest.raises(UgcValidationError, match="no resolution parameter"):
        validate_params("happy-horse", resolution="1080p")


def test_mode_is_grok_only():
    assert validate_params("grok-video", mode="spicy")["mode"] == "spicy"
    with pytest.raises(UgcValidationError, match="mode"):
        validate_params("grok-video", mode="chaotic")
    with pytest.raises(UgcValidationError, match="no mode parameter"):
        validate_params("seedance-2", mode="normal")


def test_duration_spec_shape_drives_the_ui_control():
    veo = catalog.get_model("veo-3-1")
    assert veo is not None
    assert veo.duration_spec() == {"kind": "options", "options": [8], "default": 8}

    grok = catalog.get_model("grok-video")
    assert grok is not None
    assert grok.duration_spec() == {"kind": "range", "min": 6, "max": 30, "default": 6}
