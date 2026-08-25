"""Headshot style catalog: shape, uniqueness, and the safety fence.

The catalog is the product's promise about what it will and won't draw a
real person as, so the exclusions are asserted here rather than left to a
code review that a later "just one more style" PR would sail past.
"""
from __future__ import annotations

import pytest

from marketer.headshots import STYLE_KEYS, STYLES, get_style, list_styles
from marketer.headshots.styles import UnknownStyleError


def test_keys_are_unique_and_url_safe():
    assert len(set(STYLE_KEYS)) == len(STYLE_KEYS)
    assert all(k and k == k.lower() and k.replace("_", "").isalnum() for k in STYLE_KEYS)


@pytest.mark.parametrize("style", STYLES, ids=lambda s: s.key)
def test_every_style_fills_all_four_axes(style):
    for axis in (style.wardrobe, style.lighting, style.background, style.lens):
        assert axis.strip(), f"{style.key} has an empty prompt axis"
    assert style.label.strip()
    assert style.description.strip()
    assert style.best_for.strip()


@pytest.mark.parametrize("style", STYLES, ids=lambda s: s.key)
def test_prompt_language_joins_the_axes_as_sentences(style):
    language = style.prompt_language
    # One sentence per axis, in render order, no doubled or missing stops.
    assert language.count(".") >= 4
    assert ".." not in language
    for axis in (style.wardrobe, style.lighting, style.background, style.lens):
        assert axis.strip().rstrip(".") in language


def test_get_style_round_trips():
    for key in STYLE_KEYS:
        assert get_style(key).key == key


def test_unknown_style_raises_and_names_the_alternatives():
    """A typo must never silently degrade into a generic portrait the user
    did not ask for and would still be charged for."""
    with pytest.raises(UnknownStyleError) as exc:
        get_style("ceo_in_a_lab_coat")
    assert "ceo_in_a_lab_coat" in str(exc.value)
    assert "corporate_classic" in str(exc.value)


def test_list_styles_is_the_wire_shape_the_picker_needs():
    payload = list_styles()
    assert [s["key"] for s in payload] == list(STYLE_KEYS)
    for entry in payload:
        assert set(entry) == {
            "key", "label", "description", "best_for",
            "wardrobe", "lighting", "background", "lens", "prompt_preview",
        }
        # The preview is the real prompt contribution, not a blurb.
        assert entry["prompt_preview"] == get_style(entry["key"]).prompt_language


def test_spokesperson_style_exists_for_reference_frames():
    """Other lanes (UGC, micro-drama) mint a recurring presenter from this
    one; losing it silently breaks them, not this module."""
    style = get_style("spokesperson_clean")
    assert "even" in style.lighting or "flat" in style.lighting


_FORBIDDEN = (
    # occupational costume = a fabricated credential. ("uniform" alone is
    # not a tell: a *uniformly lit* background is exactly what a clean
    # plate wants.)
    "doctor", "nurse", "lawyer", "judge", "police", "military", "in uniform",
    "scrubs", "graduation", "cap and gown", "id photo", "passport",
    # dating / personal-life packs
    "tinder", "bumble", "dating", "wedding",
    # fictional / period genres
    "cyberpunk", "anime", "cartoon", "halloween", "goddess", "fantasy",
    # newsworthy scenarios
    "protest", "championship", "award ceremony", "red carpet",
)


@pytest.mark.parametrize("style", STYLES, ids=lambda s: s.key)
def test_no_style_reintroduces_an_excluded_category(style):
    haystack = " ".join(
        (style.key, style.label, style.description, style.best_for,
         style.wardrobe, style.lighting, style.background, style.lens)
    ).lower()
    for term in _FORBIDDEN:
        assert term not in haystack, f"{style.key} reintroduces {term!r}"
