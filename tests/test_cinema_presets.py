"""Named cinema presets and the selection resolver."""
from __future__ import annotations

import pytest

from marketer.cinema import presets
from marketer.cinema.presets import CinemaOverrides, UnknownCinemaKey, resolve

# The catalog recovered from the source studio's preset artwork. Pinned
# here so removing or renaming a preset is a deliberate, reviewed change
# (a saved selection or a UI thumbnail may reference the key).
EXPECTED_KEYS = {
    "classic_anamorphic",
    "compact_anamorphic",
    "grand_format_70mm_film",
    "classic_16mm_film",
    "full_frame_cine_digital",
    "studio_digital_s35",
    "premium_large_format_digital",
    "modular_8k_digital",
    "premium_modern_prime",
    "warm_cinema_prime",
    "vintage_prime",
    "70s_cinema_prime",
    "clinical_sharp_prime",
    "swirl_bokeh_portrait",
    "halation_diffusion",
    "creative_tilt_lens",
    "extreme_macro",
    "f_1_4",
    "f_4",
    "f_11",
}


def test_full_preset_catalog():
    assert {p.key for p in presets.PRESETS} == EXPECTED_KEYS
    assert len(presets.PRESETS) == len(EXPECTED_KEYS)
    assert presets.PRESET_KEYS == tuple(p.key for p in presets.PRESETS)


def test_every_preset_has_a_label_and_description():
    for preset in presets.PRESETS:
        assert preset.label.strip()
        assert preset.description.strip()


@pytest.mark.parametrize("preset", presets.PRESETS, ids=lambda p: p.key)
def test_every_preset_resolves_and_renders(preset):
    resolved = resolve(preset.key)
    assert resolved.preset_key == preset.key
    assert resolved.image_language()
    assert resolved.motion_language()
    # The visual director caps motion prompts at 20 words.
    assert len(resolved.motion_language().split()) < 20


@pytest.mark.parametrize("preset", presets.PRESETS, ids=lambda p: p.key)
def test_resolved_selection_round_trips(preset):
    assert resolve(preset.key).as_selection() == preset.selection


def test_preset_named_for_a_component_actually_uses_it():
    """A preset named after a lens/format/aperture must contain it —
    otherwise its thumbnail lies about what it does."""
    assert resolve("classic_anamorphic").lens.key == "classic_anamorphic"
    assert resolve("extreme_macro").lens.key == "extreme_macro"
    assert resolve("grand_format_70mm_film").capture_format.key == "grand_format_70mm_film"
    assert resolve("classic_16mm_film").capture_format.key == "classic_16mm_film"
    assert resolve("f_1_4").aperture.key == "f_1_4"
    assert resolve("f_11").aperture.key == "f_11"


def test_resolve_without_a_preset_uses_the_defaults():
    resolved = resolve()
    assert resolved.preset_key is None
    assert resolved.as_selection() == presets.DEFAULT_SELECTION


def test_overrides_layer_on_top_of_a_preset():
    resolved = resolve(
        "classic_anamorphic",
        CinemaOverrides(aperture_key="f_11", grade_key="high_contrast_mono"),
    )
    assert resolved.aperture.key == "f_11"
    assert resolved.grade.key == "high_contrast_mono"
    # Untouched axes keep the preset's choice.
    assert resolved.lens.key == "classic_anamorphic"
    assert resolved.capture_format.key == "full_frame_cine_digital"


def test_none_overrides_change_nothing():
    assert resolve("vintage_prime", CinemaOverrides()) == resolve("vintage_prime")


def test_focal_override_snaps_to_the_nearest_catalogued_length():
    assert resolve("f_1_4", CinemaOverrides(focal_mm=45)).focal.mm == 50


@pytest.mark.parametrize(
    "overrides",
    [
        CinemaOverrides(format_key="imax_15perf"),
        CinemaOverrides(lens_key="not_a_lens"),
        CinemaOverrides(aperture_key="f_0_95"),
        CinemaOverrides(lighting_key="disco"),
        CinemaOverrides(diffusion_key="vaseline"),
        CinemaOverrides(grade_key="instagram_1977"),
    ],
)
def test_unknown_component_keys_raise(overrides):
    with pytest.raises(UnknownCinemaKey):
        resolve(None, overrides)


def test_unknown_preset_key_raises():
    with pytest.raises(UnknownCinemaKey, match="unknown cinema preset"):
        resolve("imax_70mm")


def test_get_preset_returns_none_for_unknown():
    assert presets.get_preset("nope") is None
    assert presets.get_preset("f_1_4") is not None


def test_image_language_is_stable_and_ordered():
    """Optics, then light, then grade — always, byte for byte."""
    resolved = resolve("grand_format_70mm_film")
    text = resolved.image_language()
    assert text == resolve("grand_format_70mm_film").image_language()
    assert text.startswith("shot on a grand-format 70mm film camera")
    assert text.index(resolved.optics_language()) == 0
    assert text.index(resolved.lighting_language()) < text.index(resolved.style_language())
    assert text.endswith("professional photography, ultra-detailed, high dynamic range")


def test_aperture_and_focal_settings_never_reach_the_prompt():
    for preset in presets.PRESETS:
        text = resolve(preset.key).image_language()
        assert "f/" not in text
        assert " 35mm" not in text and " 85mm" not in text


def test_film_and_digital_carry_different_negatives():
    film = resolve("classic_16mm_film").negatives()
    digital = resolve("modular_8k_digital").negatives()
    assert "heavy film grain" in digital
    assert "heavy film grain" not in film
    assert "digital sharpening artifacts" in film


def test_film_stock_adds_a_weave_to_the_motion_clause():
    assert resolve("classic_16mm_film").motion_language().endswith("slight film weave")
    assert "film weave" not in resolve("modular_8k_digital").motion_language()


def test_preview_matches_the_resolved_image_language():
    preset = presets.get_preset("swirl_bokeh_portrait")
    assert presets.preview(preset) == resolve(preset.key).image_language()
