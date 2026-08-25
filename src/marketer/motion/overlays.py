"""Kinetic text overlay specs and their ffmpeg `drawtext` rendering.

Pure and deterministic: this module builds data and strings only. It
never touches ffmpeg, the filesystem, or the network — `motion/pipeline`
hands the chain it returns to `services/ffmpeg`. That split is what lets
the escaping (below) be tested exhaustively without spawning a process.

Why the safe area is clamped
----------------------------
Vertical feeds paint their own chrome over the video: the account
handle/caption block eats the bottom fifth on TikTok/Reels, and the
top band carries the status bar and follow button. Text placed by a raw
percentage regularly lands underneath that chrome and is simply never
read. Every overlay's y is therefore clamped into
[TOP_SAFE, BOTTOM_SAFE] and its x is centred inside horizontal margins,
so no animation, wrap, or font-size choice can push a word off-canvas.

Why drawtext text is escaped this hard
--------------------------------------
The overlay text is narration — user- or LLM-authored. It reaches ffmpeg
as part of a filtergraph string, which is parsed TWICE before drawtext
ever sees it: once by the graph parser (which strips backslash escapes
and honours single quotes verbatim), then again by the option parser
(which splits on `:` and strips a second layer of backslash escapes).
A bare `'` or `:` in the narration therefore doesn't just break the
render, it lets the text *close the option and open another filter*.

The scheme here, mirroring the care `services/subtitle.py` takes with
ASS override braces:

1. sanitise — drop control characters and braces, fold ASCII quotes to
   typographic ones (a `'` can never terminate the graph-level quote if
   there is no `'`), collapse whitespace, truncate;
2. escape `\\`, `:` and the graph punctuation with one backslash — the
   option parser consumes it, the graph parser leaves it alone because
   the value is quoted;
3. wrap the whole value in single quotes so the graph parser copies it
   verbatim;
4. pass `expansion=none` so drawtext never evaluates `%{...}` sequences
   (which can read frame metadata and the wall clock).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

from ..services.ffmpeg import ASPECT_DIMS

Animation = Literal["fade", "pop", "rise", "slide"]
Position = Literal["top", "center", "bottom"]

# Fractions of the canvas reserved for platform chrome / breathing room.
SIDE_SAFE_RATIO = 0.08
TOP_SAFE_RATIO = 0.12
BOTTOM_SAFE_RATIO = 0.22

# Hard limits on one text block. Narration is untrusted length; an
# unbounded headline would either wrap off-canvas or blow up the filter
# string, so both the characters and the line count are capped.
MAX_TEXT_CHARS = 140
MAX_LINES = 3

# Line 2 starts a beat later than line 1: the small stagger is what makes
# the block read as "kinetic" rather than as a static caption card.
LINE_STAGGER_SEC = 0.09
LINE_HEIGHT_RATIO = 1.28
# Tail trimmed off every overlay so beat N's text is gone before beat
# N+1's text arrives (a 1-frame double-exposure reads as a glitch).
BEAT_TAIL_SEC = 0.03

_WS = re.compile(r"\s+")
_HEX = re.compile(r"^[0-9a-fA-F]{6}$")
# Special at the option-parsing layer (or at the graph layer if the value
# ever escapes its quotes). Backslash MUST be escaped first.
_ESCAPE_AFTER_BACKSLASH = (":", ",", ";", "[", "]", "=")


@dataclass(frozen=True)
class Canvas:
    width: int
    height: int

    @classmethod
    def from_aspect(cls, aspect: str) -> "Canvas":
        """Canvas for a named aspect, reusing ffmpeg's ASPECT_DIMS so the
        overlay geometry can never disagree with what concat renders."""
        try:
            w, h = ASPECT_DIMS[aspect]
        except KeyError as e:
            raise ValueError(f"unsupported aspect {aspect!r}") from e
        return cls(width=w, height=h)

    @property
    def short_side(self) -> int:
        return min(self.width, self.height)


@dataclass(frozen=True)
class OverlaySpec:
    """One line of kinetic text on screen for one time window."""

    text: str
    start: float
    end: float
    font: str
    font_size: int
    text_hex: str
    outline_hex: str
    animation: str = "fade"
    position: str = "bottom"
    box: bool = False
    box_hex: str = "000000"
    box_alpha: float = 0.55
    line: int = 0
    line_count: int = 1
    beat_index: int = 0

    def as_dict(self) -> dict:
        return {
            "text": self.text,
            "start": self.start,
            "end": self.end,
            "animation": self.animation,
            "position": self.position,
            "line": self.line,
            "line_count": self.line_count,
            "beat_index": self.beat_index,
        }


# ---------------------------------------------------------------------------
# Escaping
# ---------------------------------------------------------------------------


def sanitize_text(text: str, *, max_chars: int = MAX_TEXT_CHARS) -> str:
    """Strip everything that cannot safely survive a filtergraph.

    Control characters become spaces; `{`/`}` are dropped (they are the
    only way to form drawtext's `%{...}` expansion syntax, so removing
    them makes expansion injection impossible even if `expansion=none`
    were ever dropped); ASCII quotes fold to typographic quotes so no
    `'` can terminate the graph-level quoting; whitespace collapses.
    """
    if not text:
        return ""
    folded = []
    for ch in text:
        if ch in "{}":
            continue
        if ch == "'":
            folded.append("’")  # right single quotation mark
            continue
        if ch == '"':
            folded.append("”")  # right double quotation mark
            continue
        if unicodedata.category(ch).startswith("C"):  # control/format chars
            folded.append(" ")
            continue
        folded.append(ch)
    cleaned = _WS.sub(" ", "".join(folded)).strip()
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars].rstrip() + "…"
    return cleaned


def escape_drawtext(text: str) -> str:
    """Escape sanitised text for use inside a quoted drawtext option.

    The return value is the *inner* content: callers wrap it in single
    quotes (see `_quoted`). It is guaranteed to contain no `'`, no
    braces, no control characters, and no unescaped `:`/`\\`.
    """
    escaped = sanitize_text(text).replace("\\", "\\\\")
    for ch in _ESCAPE_AFTER_BACKSLASH:
        escaped = escaped.replace(ch, "\\" + ch)
    return escaped


def _quoted(value: str) -> str:
    """Single-quote a filter option value so the graph parser copies it
    verbatim. Only ever called with values that contain no `'`."""
    return f"'{value}'"


def _color(rgb_hex: str, alpha: float | None = None) -> str:
    """`RRGGBB` -> ffmpeg `0xRRGGBB[@a]`, refusing anything else.

    Colors come from the style catalog rather than from users, but they
    still land in a filter string, so an unparseable value degrades to a
    safe default instead of being interpolated raw."""
    value = (rgb_hex or "").strip().lstrip("#")
    if not _HEX.match(value):
        value = "FFFFFF"
    if alpha is None:
        return f"0x{value.upper()}"
    clamped = min(max(alpha, 0.0), 1.0)
    return f"0x{value.upper()}@{clamped:.2f}"


# ---------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------


def wrap_text(text: str, max_chars: int, *, max_lines: int = MAX_LINES) -> list[str]:
    """Greedy word wrap into at most `max_lines` lines.

    Overflow is truncated with an ellipsis rather than spilling: a fourth
    line would be pushed out of the safe area by the clamp below and
    silently disappear, which is worse than visibly shortened copy.
    """
    words = sanitize_text(text).split()
    if not words:
        return []
    limit = max(max_chars, 8)
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= limit or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
            if len(lines) == max_lines:
                break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) == max_lines and len(" ".join(lines)) < len(" ".join(words)):
        lines[-1] = lines[-1].rstrip(",;:") + "…"
    return lines[:max_lines]


def line_y(canvas: Canvas, *, position: str, font_size: int, line: int, line_count: int) -> int:
    """Clamped y (pixels) of one line inside the safe area."""
    line_h = int(font_size * LINE_HEIGHT_RATIO)
    block_h = line_h * max(line_count, 1)
    top_safe = int(canvas.height * TOP_SAFE_RATIO)
    bottom_safe = int(canvas.height * (1.0 - BOTTOM_SAFE_RATIO))

    if position == "top":
        block_top = top_safe
    elif position == "center":
        block_top = (canvas.height - block_h) // 2
    else:  # bottom (default)
        block_top = bottom_safe - block_h

    y = block_top + line * line_h
    # Clamp so no animation/wrap/font-size combination can leave the safe
    # band. `lo <= hi` is guaranteed by the max() on the upper bound.
    lo = top_safe
    hi = max(bottom_safe - line_h, lo)
    return int(min(max(y, lo), hi))


# ---------------------------------------------------------------------------
# Animation expressions
# ---------------------------------------------------------------------------


def _ramp(spec: OverlaySpec, default: float) -> float:
    """Animation ramp length, never more than a third of the window."""
    return round(min(default, max(spec.end - spec.start, 0.06) / 3.0), 3)


def _alpha_expr(spec: OverlaySpec) -> str | None:
    s, e = spec.start, spec.end
    if spec.animation == "pop":
        f = _ramp(spec, 0.08)  # snappy: no perceptible fade, just a beat
        return f"min(1,(t-{s:.3f})/{f:.3f})"
    if spec.animation in ("fade", "rise", "slide"):
        f = _ramp(spec, 0.25)
        return (
            f"if(lt(t,{s + f:.3f}),(t-{s:.3f})/{f:.3f},"
            f"if(gt(t,{e - f:.3f}),max(0,({e:.3f}-t)/{f:.3f}),1))"
        )
    return None


def _x_expr(spec: OverlaySpec, canvas: Canvas) -> str:
    centered = "(w-text_w)/2"
    if spec.animation != "slide":
        return centered
    r = _ramp(spec, 0.22)
    travel = int(canvas.width * SIDE_SAFE_RATIO * 2)
    # Slide in from the leading edge, settling at centre.
    return f"{centered}-{travel}*(1-min(1,(t-{spec.start:.3f})/{r:.3f}))"


def _y_expr(spec: OverlaySpec, canvas: Canvas) -> str:
    base = line_y(
        canvas,
        position=spec.position,
        font_size=spec.font_size,
        line=spec.line,
        line_count=spec.line_count,
    )
    if spec.animation != "rise":
        return str(base)
    r = _ramp(spec, 0.22)
    lift = max(int(spec.font_size * 0.45), 8)
    # Rises into place; never travels *below* the clamped baseline, so the
    # safe-area guarantee holds for every frame of the animation.
    return f"{base}+{lift}*(1-min(1,(t-{spec.start:.3f})/{r:.3f}))"


# ---------------------------------------------------------------------------
# Filter rendering
# ---------------------------------------------------------------------------


def drawtext_filter(spec: OverlaySpec, canvas: Canvas) -> str:
    """One `drawtext=...` filter for one overlay line."""
    opts = [
        f"text={_quoted(escape_drawtext(spec.text))}",
        # No %{...} evaluation: the text is untrusted and expansion can
        # read frame metadata / the wall clock into the burned frame.
        "expansion=none",
        f"font={_quoted(escape_drawtext(spec.font))}",
        f"fontsize={int(spec.font_size)}",
        f"fontcolor={_color(spec.text_hex)}",
        f"borderw={max(int(spec.font_size * 0.06), 2)}",
        f"bordercolor={_color(spec.outline_hex)}",
        f"shadowcolor={_color('000000', 0.55)}",
        "shadowx=2",
        "shadowy=3",
        f"x={_quoted(_x_expr(spec, canvas))}",
        f"y={_quoted(_y_expr(spec, canvas))}",
        f"enable={_quoted(f'between(t,{spec.start:.3f},{spec.end:.3f})')}",
    ]
    if spec.box:
        opts += [
            "box=1",
            f"boxcolor={_color(spec.box_hex, spec.box_alpha)}",
            f"boxborderw={max(int(spec.font_size * 0.25), 6)}",
        ]
    alpha = _alpha_expr(spec)
    if alpha is not None:
        opts.append(f"alpha={_quoted(alpha)}")
    return "drawtext=" + ":".join(opts)


def filter_chain(specs: list[OverlaySpec], canvas: Canvas) -> str:
    """The full `-vf` chain for a list of overlays ("" when there are none)."""
    return ",".join(drawtext_filter(s, canvas) for s in specs)


# ---------------------------------------------------------------------------
# Spec construction
# ---------------------------------------------------------------------------


def font_size_for(canvas: Canvas, font_scale: float) -> int:
    """Font size in pixels, floored so text stays legible on a phone."""
    return max(int(canvas.short_side * font_scale), 24)


def build_overlays(beats, style, canvas: Canvas) -> list[OverlaySpec]:
    """Beats + style -> one staggered text block per beat.

    `beats` is a list of `beats.Beat`; `style` a `styles.MotionStyle`.
    Kept structurally typed (no import) so this module stays a leaf.
    """
    size = font_size_for(canvas, style.font_scale)
    specs: list[OverlaySpec] = []
    for beat in beats:
        text = beat.text.upper() if style.uppercase else beat.text
        lines = wrap_text(text, style.line_max_chars)
        if not lines:
            continue
        end = max(beat.end - BEAT_TAIL_SEC, beat.start + 0.1)
        for i, line in enumerate(lines):
            start = min(beat.start + i * LINE_STAGGER_SEC, max(end - 0.1, beat.start))
            specs.append(
                OverlaySpec(
                    text=line,
                    start=round(start, 3),
                    end=round(end, 3),
                    font=style.font,
                    font_size=size,
                    text_hex=style.text_hex,
                    outline_hex=style.outline_hex,
                    animation=style.animation,
                    position=style.position,
                    box=style.box,
                    box_hex=style.box_hex,
                    box_alpha=style.box_alpha,
                    line=i,
                    line_count=len(lines),
                    beat_index=beat.index,
                )
            )
    return specs


def build_word_overlays(beats, words: list[dict], style, canvas: Canvas) -> list[OverlaySpec]:
    """One popped word at a time, word timings driving each in/out.

    This is the punchiest treatment and the most expensive in filter
    length, so it is opt-in per style (`overlay_mode='word'`). Words
    outside any beat window are dropped — the beat model, not the raw
    transcript, owns the timeline.
    """
    from .beats import normalize_words  # local: keeps the module import-cycle free

    size = font_size_for(canvas, style.font_scale * 1.15)
    normalized = normalize_words(words)
    specs: list[OverlaySpec] = []
    for beat in beats:
        in_beat = [w for w in normalized if w.start >= beat.start and w.start < beat.end]
        for w in in_beat:
            text = w.text.upper() if style.uppercase else w.text
            end = min(w.end, beat.end)
            if end <= w.start:
                continue
            specs.append(
                OverlaySpec(
                    text=text,
                    start=round(w.start, 3),
                    end=round(end, 3),
                    font=style.font,
                    font_size=size,
                    text_hex=style.text_hex,
                    outline_hex=style.outline_hex,
                    animation="pop",
                    position=style.position,
                    box=style.box,
                    box_hex=style.box_hex,
                    box_alpha=style.box_alpha,
                    line=0,
                    line_count=1,
                    beat_index=beat.index,
                )
            )
    return specs
