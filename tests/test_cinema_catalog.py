"""Cinematography component catalogs (pure data, no fixtures needed)."""
from __future__ import annotations

import re

import pytest

from marketer.cinema import film_stocks, grades, lenses


def _keys(items) -> list[str]:
    return [i.key for i in items]


# ------------------------------------------------------------------ shape


@pytest.mark.parametrize(
    "items",
    [
        lenses.LENSES,
        lenses.APERTURES,
        film_stocks.CAPTURE_FORMATS,
        grades.LIGHTING_SETUPS,
        grades.DIFFUSION_FILTERS,
        grades.COLOR_GRADES,
    ],
)
def test_keys_are_unique_and_slugged(items):
    keys = _keys(items)
    assert len(keys) == len(set(keys))
    for key in keys:
        assert re.fullmatch(r"[a-z0-9_]+", key), key


@pytest.mark.parametrize(
    "items",
    [
        lenses.LENSES,
        lenses.APERTURES,
        film_stocks.CAPTURE_FORMATS,
        grades.LIGHTING_SETUPS,
        grades.COLOR_GRADES,
    ],
)
def test_every_entry_has_label_and_phrase(items):
    for item in items:
        assert item.label.strip()
        assert item.phrase.strip()


def test_only_the_none_diffusion_has_an_empty_phrase():
    """A 'no diffusion' phrase would be read as a request for diffusion,
    so the null option renders to nothing at all."""
    empty = [d.key for d in grades.DIFFUSION_FILTERS if not d.phrase]
    assert empty == ["none"]


# ------------------------------------------------ prose, not parameter strings


def test_aperture_phrases_never_print_the_f_stop():
    for aperture in lenses.APERTURES:
        assert "f/" not in aperture.phrase
        assert not re.search(r"\d", aperture.phrase), aperture.key
        # The number survives where only the UI sees it.
        assert aperture.label.startswith("f/")


def test_focal_phrases_never_print_millimetres():
    for focal in lenses.FOCAL_LENGTHS:
        assert "mm" not in focal.phrase
        assert not re.search(r"\d", focal.phrase), focal.mm
        assert focal.label == f"{focal.mm}mm"


def test_grade_phrases_never_carry_a_hex_code():
    """Same doctrine as marketer.adcreative.colors: models paint hex."""
    for grade in grades.COLOR_GRADES:
        assert "#" not in grade.phrase


# ------------------------------------------------------------------ lookups


def test_recovered_lens_catalog():
    assert set(_keys(lenses.LENSES)) == {
        "premium_modern_prime",
        "warm_cinema_prime",
        "vintage_prime",
        "70s_cinema_prime",
        "clinical_sharp_prime",
        "classic_anamorphic",
        "compact_anamorphic",
        "swirl_bokeh_portrait",
        "halation_diffusion",
        "creative_tilt_lens",
        "extreme_macro",
    }


def test_recovered_capture_formats():
    assert set(_keys(film_stocks.CAPTURE_FORMATS)) == {
        "grand_format_70mm_film",
        "classic_16mm_film",
        "premium_large_format_digital",
        "full_frame_cine_digital",
        "studio_digital_s35",
        "modular_8k_digital",
    }


def test_recovered_focal_lengths():
    assert [f.mm for f in lenses.FOCAL_LENGTHS] == [8, 14, 24, 35, 50, 85]


def test_getters_return_none_for_unknown_keys():
    assert lenses.get_lens("nope") is None
    assert lenses.get_aperture("f_0_95") is None
    assert lenses.get_focal_length(21) is None
    assert film_stocks.get_format("imax") is None
    assert grades.get_lighting("nope") is None
    assert grades.get_diffusion("nope") is None
    assert grades.get_grade("nope") is None


def test_defaults_exist_in_their_catalogs():
    assert lenses.get_lens(lenses.DEFAULT_LENS_KEY) is not None
    assert lenses.get_aperture(lenses.DEFAULT_APERTURE_KEY) is not None
    assert lenses.get_focal_length(lenses.DEFAULT_FOCAL_MM) is not None
    assert film_stocks.get_format(film_stocks.DEFAULT_FORMAT_KEY) is not None
    assert grades.get_lighting(grades.DEFAULT_LIGHTING_KEY) is not None
    assert grades.get_diffusion(grades.DEFAULT_DIFFUSION_KEY) is not None
    assert grades.get_grade(grades.DEFAULT_GRADE_KEY) is not None


# ------------------------------------------------------------------ behavior


@pytest.mark.parametrize(
    ("requested", "expected"),
    [
        (35, 35),
        (45, 50),
        (1, 8),
        (400, 85),
        (11, 8),   # tie at 3mm either way -> the shorter lens wins
        (19, 14),  # tie at 5mm either way -> the shorter lens wins
    ],
)
def test_nearest_focal_length_snaps_and_breaks_ties_downward(requested, expected):
    assert lenses.nearest_focal_length(requested).mm == expected


def test_every_medium_supplies_its_own_negatives():
    media = {f.medium for f in film_stocks.CAPTURE_FORMATS}
    assert media == set(grades.MEDIUM_NEGATIVES)
    # Film keeps its grain; digital must not acquire any.
    assert "heavy film grain" in grades.MEDIUM_NEGATIVES["digital"]
    assert "heavy film grain" not in grades.MEDIUM_NEGATIVES["film"]


def test_formats_for_medium_partitions_the_catalog():
    film = film_stocks.formats_for_medium("film")
    digital = film_stocks.formats_for_medium("digital")
    assert len(film) + len(digital) == len(film_stocks.CAPTURE_FORMATS)
    assert {f.key for f in film} == {"grand_format_70mm_film", "classic_16mm_film"}


def test_lens_families_are_all_representable_as_motion():
    from marketer.cinema.presets import _MOTION_BY_LENS_FAMILY

    assert {lens.family for lens in lenses.LENSES} <= set(_MOTION_BY_LENS_FAMILY)


def test_default_focal_lengths_are_catalogued():
    for lens in lenses.LENSES:
        assert lenses.get_focal_length(lens.default_focal_mm) is not None
