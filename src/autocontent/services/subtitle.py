"""Render word-level timings to an .ass subtitle file.

Style: single word on screen at a time, large bold sans, bottom-third,
white fill with thick black outline + drop shadow — the visual idiom
TikTok/Reels/Shorts viewers expect for short-form. Each word gets its
own Dialogue line that pops in at the word's `start` and disappears at
its `end`.

Layout assumes the canvas dimensions ffmpeg renders at (PlayResX/Y
below); the burn step (`ass=...`) scales these to the video size.
"""
from __future__ import annotations

from pathlib import Path

PLAY_RES_X = 1080
PLAY_RES_Y = 1920

# (font_name, font_size, primary_hex_bgr, outline_hex_bgr, outline_px, shadow_px, margin_v)
STYLES: dict[str, tuple[str, int, str, str, int, int, int]] = {
    "tiktok-bold": ("Arial Black", 96, "FFFFFF", "000000", 6, 3, 480),
}


def _to_ass_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - (h * 3600) - (m * 60)
    return f"{h:d}:{m:02d}:{s:05.2f}"


def _ass_color(bgr_hex: str) -> str:
    return f"&H00{bgr_hex.upper()}"


def _header(style: str) -> str:
    font, size, primary, outline, outline_px, shadow_px, margin_v = STYLES[style]
    primary_c = _ass_color(primary)
    outline_c = _ass_color(outline)
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
        f"Style: Default,{font},{size},{primary_c},{primary_c},{outline_c},"
        f"&H00000000,-1,0,0,0,100,100,0,0,1,{outline_px},{shadow_px},"
        f"2,60,60,{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _escape(word: str) -> str:
    return word.replace("{", "(").replace("}", ")").replace("\n", " ").strip()


def words_to_ass(words: list[dict], out_path: Path, style: str = "tiktok-bold") -> Path:
    """Emit a karaoke-style ASS file — one word on screen at a time."""
    if style not in STYLES:
        raise ValueError(f"unknown subtitle style: {style!r}")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines = [_header(style)]
    for w in words:
        text = _escape(str(w["word"]))
        if not text:
            continue
        start = _to_ass_time(float(w["start"]))
        end = _to_ass_time(float(w["end"]))
        lines.append(
            f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n"
        )
    out_path.write_text("".join(lines), encoding="utf-8")
    return out_path
