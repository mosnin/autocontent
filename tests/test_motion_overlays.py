"""Kinetic text overlays: layout, safe area, and drawtext escaping.

The escaping half is the point. Overlay text is narration — user- or
LLM-authored — and it lands inside an ffmpeg filtergraph string that is
parsed twice before drawtext sees it. A single unescaped `'` or `:` does
not merely break the render: it closes the option and opens another
filter. These tests prove hostile text is neutralized without spawning
ffmpeg, which is exactly what keeping `motion.overlays` pure buys.
"""
from __future__ import annotations

import pytest

from marketer.motion.beats import Beat
from marketer.motion.overlays import (
    BOTTOM_SAFE_RATIO,
    MAX_LINES,
    MAX_TEXT_CHARS,
    TOP_SAFE_RATIO,
    Canvas,
    OverlaySpec,
    build_overlays,
    build_word_overlays,
    drawtext_filter,
    escape_drawtext,
    filter_chain,
    font_size_for,
    line_y,
    sanitize_text,
    wrap_text,
)
from marketer.motion.styles import get_style

CANVAS = Canvas(width=1080, height=1920)


def spec(text: str, **over) -> OverlaySpec:
    base = dict(
        text=text,
        start=0.0,
        end=2.0,
        font="Arial Black",
        font_size=64,
        text_hex="FFFFFF",
        outline_hex="101010",
    )
    base.update(over)
    return OverlaySpec(**base)


# --------------------------------------------------------------- escaping

# Every one of these is a real filtergraph escape, not a theoretical one.
HOSTILE = [
    "drop':drawtext=text='pwned",          # close the option, open a filter
    "a:b:c",                                # option separator
    "back\\slash",                          # escape character
    "%{pts\\:hms}",                         # drawtext expansion
    "{eval:something}",                     # brace expansion
    "commas, semis; brackets[0]=1",         # graph punctuation
    'say "hi" and \'bye\'',                 # both quote flavours
    "line\nbreak\ttab\r",                   # control characters
    "[in]scale=1:1[out]",                   # a whole filter chain
    "'" * 40,                               # quote flood
]


@pytest.mark.parametrize("hostile", HOSTILE)
def test_hostile_text_cannot_escape_its_drawtext_option(hostile):
    rendered = drawtext_filter(spec(hostile), CANVAS)

    # 1. The filter is still exactly one drawtext.
    assert rendered.startswith("drawtext=")
    assert rendered.count("drawtext=") == 1

    body = rendered.split("drawtext=text=", 1)[1]
    assert body.startswith("'")
    value = body[1 : body.index("'", 1)]

    # 2. No quote survived, so the graph-level quoting cannot be closed.
    assert "'" not in value
    assert '"' not in value
    # 3. Every option separator inside the value is backslash-escaped.
    for i, ch in enumerate(value):
        if ch in ":,;[]=":
            assert i > 0 and value[i - 1] == "\\", f"unescaped {ch!r} in {value!r}"
    # 4. Braces are gone entirely, so %{...} cannot be formed at all.
    assert "{" not in value and "}" not in value
    # 5. No raw control characters reached the filter string.
    assert not any(ord(c) < 0x20 for c in value)
    # 6. Expansion is off regardless.
    assert "expansion=none" in rendered


def test_the_escaped_value_keeps_the_readable_words():
    """Neutralizing must not silently blank the copy."""
    out = escape_drawtext("Cost: $4.50 (that's cheap)")
    assert "Cost" in out and "cheap" in out
    assert "\\:" in out


def test_sanitize_folds_quotes_to_typographic_ones():
    assert sanitize_text("it's a \"quote\"") == "it’s a “quote”".replace("“", "”")


def test_sanitize_truncates_untrusted_length():
    out = sanitize_text("word " * 400)
    assert len(out) <= MAX_TEXT_CHARS + 1  # + the ellipsis
    assert out.endswith("…")


def test_backslash_is_escaped_before_everything_else():
    """`\\:` must not be produced from a literal backslash + colon pair in
    a way that lets the colon through."""
    out = escape_drawtext("a\\:b")
    assert out == "a\\\\\\:b"


def test_the_font_name_is_escaped_too():
    rendered = drawtext_filter(spec("hello", font="Evil':x=0"), CANVAS)
    font_value = rendered.split(":font=", 1)[1]
    assert font_value.startswith("'")
    assert "'" not in font_value[1 : font_value.index("'", 1)]


def test_a_bad_color_degrades_to_a_safe_default():
    rendered = drawtext_filter(spec("hi", text_hex="not-a-color':x=0"), CANVAS)
    assert "fontcolor=0xFFFFFF" in rendered


def test_filter_chain_joins_with_commas_and_is_empty_when_there_is_nothing():
    assert filter_chain([], CANVAS) == ""
    chain = filter_chain([spec("one"), spec("two")], CANVAS)
    assert chain.count("drawtext=") == 2
    assert ",drawtext=" in chain


# ----------------------------------------------------------------- layout


def test_every_line_stays_inside_the_platform_safe_area():
    top = int(1920 * TOP_SAFE_RATIO)
    bottom = int(1920 * (1.0 - BOTTOM_SAFE_RATIO))
    for position in ("top", "center", "bottom"):
        for count in range(1, MAX_LINES + 1):
            for line in range(count):
                y = line_y(
                    CANVAS, position=position, font_size=96, line=line, line_count=count
                )
                assert top <= y <= bottom


def test_wrap_never_exceeds_the_line_budget_and_marks_truncation():
    lines = wrap_text("one two three four five six seven eight nine ten", 10)
    assert len(lines) <= MAX_LINES
    assert lines[-1].endswith("…")


def test_wrap_keeps_an_overlong_single_word():
    assert wrap_text("supercalifragilistic", 8) == ["supercalifragilistic"]


def test_font_size_has_a_legibility_floor():
    assert font_size_for(Canvas(width=64, height=64), 0.01) == 24


def test_canvas_from_aspect_matches_ffmpeg_and_rejects_the_unknown():
    assert Canvas.from_aspect("9:16") == Canvas(1080, 1920)
    with pytest.raises(ValueError):
        Canvas.from_aspect("21:9")


# ------------------------------------------------------------ build specs


def beats(*texts) -> list[Beat]:
    return [
        Beat(index=i, start=i * 3.0, end=i * 3.0 + 3.0, text=t)
        for i, t in enumerate(texts)
    ]


def test_build_overlays_staggers_lines_and_clears_before_the_next_beat():
    style = get_style("modern-flat")
    out = build_overlays(beats("A much longer beat that has to wrap over lines", "second"), style, CANVAS)
    first = [o for o in out if o.beat_index == 0]
    assert len(first) > 1
    assert first[0].start < first[1].start  # the stagger
    # Beat 0's text is gone before beat 1's arrives.
    assert max(o.end for o in first) < min(o.start for o in out if o.beat_index == 1)


def test_build_overlays_uppercases_only_when_the_style_says_so():
    upper = build_overlays(beats("hello there"), get_style("modern-flat"), CANVAS)
    lower = build_overlays(beats("hello there"), get_style("swiss-modern"), CANVAS)
    assert upper[0].text.isupper()
    assert not lower[0].text.isupper()


def test_word_mode_drops_words_outside_every_beat():
    style = get_style("punk-zine")
    words = [
        {"word": "in", "start": 0.5, "end": 1.0},
        {"word": "also", "start": 1.5, "end": 2.0},
        {"word": "out", "start": 90.0, "end": 91.0},
    ]
    out = build_word_overlays(beats("in also"), words, style, CANVAS)
    assert [o.text for o in out] == ["IN", "ALSO"]


def test_an_empty_beat_produces_no_overlay():
    assert build_overlays(beats("   "), get_style("modern-flat"), CANVAS) == []


def test_the_animation_expressions_stay_inside_the_window():
    for animation in ("fade", "pop", "rise", "slide"):
        rendered = drawtext_filter(
            spec("hi", animation=animation, start=1.0, end=1.2), CANVAS
        )
        assert "enable='between(t,1.000,1.200)'" in rendered
        # A ramp longer than the window would leave the text mid-fade.
        assert "/0.0" not in rendered.replace("/0.067", "")
