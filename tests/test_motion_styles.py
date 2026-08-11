"""The motion-style catalog, its wire shape, and the bake-off.

The catalog is code, not data, so these tests are the contract: the
picker renders `catalog()` directly, and the bake-off spends money, so
both its bound and its determinism matter.
"""
from __future__ import annotations

import pytest

from marketer.motion.overlays import Canvas, build_overlays, drawtext_filter
from marketer.motion.beats import Beat
from marketer.motion.styles import (
    AUTO_STYLE_KEY,
    BAKEOFF_CANDIDATES,
    BAKEOFF_QUALITY,
    DEFAULT_STYLE_KEY,
    NO_BAKED_TEXT,
    STYLES,
    UnknownStyle,
    catalog,
    get_style,
    keyframe_prompt,
    pick_winner,
    plan_bakeoff,
    score_style,
    stock_query,
)

CANVAS = Canvas(1080, 1920)


def test_every_style_is_self_consistent():
    for key, style in STYLES.items():
        assert style.key == key
        assert style.label and style.description and style.type_preview
        assert style.idiom and style.palette and style.finish
        assert style.position in ("top", "center", "bottom")
        assert style.animation in ("fade", "pop", "rise", "slide")
        assert style.overlay_mode in ("block", "word")
        assert 0.0 < style.font_scale < 0.2
        assert len(style.text_hex) == 6 and len(style.outline_hex) == 6


def test_a_word_mode_style_does_not_also_burn_word_captions():
    """Both would render the same words twice, on top of each other."""
    for style in STYLES.values():
        if style.overlay_mode == "word":
            assert style.word_captions is False


def test_catalog_carries_the_typographic_preview_the_picker_needs():
    rows = catalog()
    assert {r["key"] for r in rows} == set(STYLES)
    for row in rows:
        preview = row["preview"]
        assert preview["type_preview"]
        assert preview["swatch"].startswith("linear-gradient")
        assert set(preview) >= {
            "type_preview", "font", "uppercase", "position",
            "animation", "text_hex", "outline_hex", "swatch", "overlay_mode",
        }
        assert row["palette"] and row["finish"]


def test_get_style_falls_back_for_none_and_auto_and_raises_otherwise():
    assert get_style(None).key == DEFAULT_STYLE_KEY
    assert get_style(AUTO_STYLE_KEY).key == DEFAULT_STYLE_KEY
    assert get_style("punk-zine").key == "punk-zine"
    with pytest.raises(UnknownStyle):
        get_style("no-such-style")


def test_the_keyframe_prompt_bans_baked_text_and_bounds_the_scene():
    style = get_style("newsprint-editorial")
    prompt = keyframe_prompt(style, "x" * 2000, aspect="9:16")
    assert NO_BAKED_TEXT in prompt
    assert style.idiom in prompt and style.palette in prompt
    assert "9:16" in prompt
    # The scene clause is truncated: narration length is user-controlled.
    assert len(prompt) < 2000


def test_stock_query_applies_the_style_bias_and_bounds_the_keyword():
    style = get_style("gilded-deco")
    assert stock_query(style, "pouring wine") == "pouring wine luxury elegant slow motion"
    assert len(stock_query(style, "k" * 500)) < 200


def test_the_bakeoff_is_bounded_and_cheap():
    plan = plan_bakeoff("a beat about coffee")
    assert [c.style_key for c in plan] == list(BAKEOFF_CANDIDATES)
    assert all(c.quality == BAKEOFF_QUALITY for c in plan)
    assert all(c.size == "1024x1024" for c in plan)


def test_the_bakeoff_ignores_candidates_outside_the_catalog():
    plan = plan_bakeoff("brief", candidates=("modern-flat", "not-a-style"))
    assert [c.style_key for c in plan] == ["modern-flat"]


def test_style_scoring_and_the_winner_are_deterministic():
    brief = "a punk rant about the music hustle"
    keys = list(BAKEOFF_CANDIDATES)
    assert pick_winner(keys, brief) == pick_winner(keys, brief) == "punk-zine"
    assert score_style(STYLES["punk-zine"], brief) > score_style(STYLES["swiss-modern"], brief)


def test_the_winner_falls_back_rather_than_failing():
    assert pick_winner([], "anything") == DEFAULT_STYLE_KEY
    assert pick_winner(["nope"], "anything") == DEFAULT_STYLE_KEY
    # No signal at all still resolves, in catalog order.
    assert pick_winner(["modern-flat", "punk-zine"], "") == "modern-flat"


def test_every_style_renders_a_valid_drawtext_filter():
    """A style is only real if it survives the escaping path."""
    beat = [Beat(index=0, start=0.0, end=3.0, text="It's a test: 100% real")]
    for style in STYLES.values():
        specs = build_overlays(beat, style, CANVAS)
        assert specs
        for s in specs:
            rendered = drawtext_filter(s, CANVAS)
            assert rendered.startswith("drawtext=")
            assert rendered.count("drawtext=") == 1
