"""Render word-level timings to an .ass subtitle file.

Default style: single word on screen at a time, large bold sans,
bottom-third, white fill with thick black outline + drop shadow — the
visual idiom TikTok/Reels/Shorts viewers expect for short-form. Each
word gets its own Dialogue line that pops in at the word's `start` and
disappears at its `end`.

The look is bespoke per niche via ``CaptionStyle`` (creative brief):
font, size, fill/outline colors, uppercase, and vertical position all
flow into the generated header. Layout assumes the canvas dimensions
ffmpeg renders at (PlayResX/Y below); the burn step (`ass=...`) scales
these to the video size.
"""
from __future__ import annotations

from pathlib import Path

from ..models.creative_brief import CaptionStyle

PLAY_RES_X = 1080
PLAY_RES_Y = 1920

# (ASS alignment code, MarginV) per vertical position. Alignment uses the
# numpad scheme: 2 = bottom-center, 5 = middle-center, 8 = top-center.
_POSITIONS: dict[str, tuple[int, int]] = {
    "bottom": (2, 480),
    "center": (5, 0),
    "top": (8, 160),
}

OUTLINE_PX = 6
SHADOW_PX = 3


def _to_ass_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - (h * 3600) - (m * 60)
    return f"{h:d}:{m:02d}:{s:05.2f}"


def _rgb_to_ass_color(rgb_hex: str) -> str:
    """RRGGBB (human order) -> ASS &H00BBGGRR (BGR order)."""
    rgb = rgb_hex.strip().lstrip("#")
    r, g, b = rgb[0:2], rgb[2:4], rgb[4:6]
    return f"&H00{b.upper()}{g.upper()}{r.upper()}"


def _header(style: CaptionStyle) -> str:
    alignment, margin_v = _POSITIONS[style.position]
    primary_c = _rgb_to_ass_color(style.text_hex)
    outline_c = _rgb_to_ass_color(style.outline_hex)
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {PLAY_RES_X}\n"
        f"PlayResY: {PLAY_RES_Y}\n"
        "ScaledBorderAndShadow: yes\n"
        "WrapStyle: 2\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{style.font},{style.font_size},{primary_c},{primary_c},"
        f"{outline_c},&H00000000,-1,0,0,0,100,100,0,0,1,{OUTLINE_PX},{SHADOW_PX},"
        f"{alignment},60,60,{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _escape(word: str) -> str:
    return word.replace("{", "(").replace("}", ")").replace("\n", " ").strip()


def words_to_ass(
    words: list[dict],
    out_path: Path,
    caption_style: CaptionStyle | None = None,
) -> Path:
    """Emit a karaoke-style ASS file — one word on screen at a time.

    ``caption_style=None`` renders the stock look (identical to the
    pre-brief behavior)."""
    style = caption_style or CaptionStyle()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines = [_header(style)]
    for w in words:
        text = _escape(str(w["word"]))
        if not text:
            continue
        if style.uppercase:
            text = text.upper()
        start = _to_ass_time(float(w["start"]))
        end = _to_ass_time(float(w["end"]))
        lines.append(
            f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n"
        )
    out_path.write_text("".join(lines), encoding="utf-8")
    return out_path
