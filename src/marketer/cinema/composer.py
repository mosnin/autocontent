"""Structured prompt composer.

A prompt stops being an opaque string and becomes seven named segments —
subject, action, setting, lighting, camera, style, negatives — that
assemble into final text by one fixed rule. That buys three things the
pipeline did not have:

* **Inspectable** — the UI (and the job record) can show *which* segment
  contributed which clause, instead of a 400-character blob.
* **Reusable** — a segment set is a value: save it, diff it, reapply the
  camera segment to a different subject.
* **Deterministic** — the same segments plus the same preset always
  produce byte-identical text. Nothing here sorts by set iteration,
  reads a clock, or consults a dict whose order could change. Prompt
  drift between two "identical" runs is invisible and expensive, so the
  determinism is a tested property, not a hope.

Assembly rule
-------------
Segments are joined with ", " in `SEGMENT_ORDER` and empty segments are
dropped entirely. Order matters to every diffusion model: earlier tokens
carry more weight, so the subject leads and the quality tail trails.

A cinema preset does not become a segment of its own. Its optics fold
into `camera`, its light into `lighting`, its grade into `style` — after
whatever the user wrote there, so the user's words keep the stronger
position and the preset refines rather than overrides.

Sanitizing
----------
Free text arriving from a UI carries parameter syntax: `--ar 16:9`,
`seed=42`, `#543cfc`. Image models paint what they are shown — a hex
code becomes a hex code stencilled on a wall — which is exactly why
`marketer.adcreative.colors` converts brand hex into "vivid violet"
before any prompt sees it. `_prompt_safe` applies the same doctrine
here: flags and `key=value` tokens are dropped, hex colors are replaced
with their color *name* via that same module (one implementation, not
two).
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field

from ..adcreative.colors import describe_color
from .presets import CinemaOverrides, ResolvedCinema, resolve

# Fixed assembly order. Earlier segments carry more weight with every
# diffusion model, so the subject leads and the style tail trails.
SEGMENT_ORDER: tuple[str, ...] = (
    "subject",
    "action",
    "setting",
    "lighting",
    "camera",
    "style",
)

# Always-on negatives. Text inside a generated image is the platform's
# oldest failure mode — captions are burned in separately by ffmpeg and
# image models garble any lettering they attempt — so every composed
# prompt bans it, matching the visual director's own hard rule.
BASE_NEGATIVES: tuple[str, ...] = (
    "text",
    "words",
    "letters",
    "captions",
    "subtitles",
    "watermark",
    "logo",
    "signage",
    "extra fingers",
    "deformed hands",
    "blurry",
    "low resolution",
)

MAX_SEGMENT_CHARS = 2000
MAX_NEGATIVES = 40

_WHITESPACE = re.compile(r"\s+")
# `--ar 16:9`, `--style raw`, `-n 4` — CLI flags pasted from other tools.
_CLI_FLAG = re.compile(r"(?:^|\s)-{1,2}[a-zA-Z][\w-]*(?:[ =]\S+)?")
# `seed=42`, `guidance_scale:7.5` — parameter syntax in prose.
_PARAM_TOKEN = re.compile(r"(?:^|\s)[a-zA-Z_][\w]*\s*[=:]\s*-?\d+(?:\.\d+)?")
_HEX_COLOR = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
# Midjourney-style token weights: "sunset::2".
_TOKEN_WEIGHT = re.compile(r"::-?\d+(?:\.\d+)?")


class PromptSegments(BaseModel):
    """The composer's input. Every field optional: an empty segment set
    composes to an empty prompt rather than an error, so a UI can call
    this on every keystroke."""

    subject: str = Field(default="", max_length=MAX_SEGMENT_CHARS)
    action: str = Field(default="", max_length=MAX_SEGMENT_CHARS)
    setting: str = Field(default="", max_length=MAX_SEGMENT_CHARS)
    lighting: str = Field(default="", max_length=MAX_SEGMENT_CHARS)
    camera: str = Field(default="", max_length=MAX_SEGMENT_CHARS)
    style: str = Field(default="", max_length=MAX_SEGMENT_CHARS)
    negatives: list[str] = Field(default_factory=list, max_length=MAX_NEGATIVES)


class ComposedPrompt(BaseModel):
    prompt: str
    negative_prompt: str
    # The post-merge segment text, so a caller can see exactly which
    # segment contributed which clause of `prompt`.
    segments: dict[str, str]
    # Short single-move clause for the animation stage, when a cinema
    # selection was applied. Empty otherwise.
    motion_prompt: str = ""


def _prompt_safe(text: str) -> str:
    """Strip parameter syntax; turn hex colors into color names."""
    out = _HEX_COLOR.sub(lambda m: describe_color(m.group(0)), text)
    out = _TOKEN_WEIGHT.sub("", out)
    out = _CLI_FLAG.sub(" ", out)
    out = _PARAM_TOKEN.sub(" ", out)
    return out


def _clean(text: str) -> str:
    """Normalize one segment into a single comma-joinable clause."""
    out = _prompt_safe(text or "")
    out = _WHITESPACE.sub(" ", out).strip()
    # Trailing punctuation would double up against the ", " join.
    return out.strip(" ,;.")


def _merge(base: str, addition: str) -> str:
    """Append preset language after the user's own words for a segment.

    The user leads: their phrasing keeps the heavier early position and
    the preset refines it.
    """
    if not addition:
        return base
    if not base:
        return addition
    return f"{base}, {addition}"


def _dedupe(values: list[str]) -> list[str]:
    """Case-insensitive dedupe that preserves first-seen order.

    Order-preserving on purpose: a `set` would make the negative prompt
    reorder between runs, which is exactly the invisible drift this
    module exists to prevent.
    """
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        cleaned = _clean(value)
        if not cleaned:
            continue
        fingerprint = cleaned.lower()
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        out.append(cleaned)
    return out


def compose(
    segments: PromptSegments,
    *,
    preset_key: str | None = None,
    overrides: CinemaOverrides | None = None,
    include_base_negatives: bool = True,
) -> ComposedPrompt:
    """Assemble segments (plus an optional cinema selection) into text.

    Pure: no I/O, no spend, no persistence. Raises `UnknownCinemaKey`
    when `preset_key` or an override names a catalog entry that does not
    exist.
    """
    cinema: ResolvedCinema | None = None
    if preset_key is not None or overrides is not None:
        cinema = resolve(preset_key, overrides)

    merged: dict[str, str] = {name: _clean(getattr(segments, name)) for name in SEGMENT_ORDER}
    if cinema is not None:
        merged["lighting"] = _merge(merged["lighting"], cinema.lighting_language())
        merged["camera"] = _merge(merged["camera"], cinema.optics_language())
        merged["style"] = _merge(merged["style"], cinema.style_language())

    prompt = ", ".join(merged[name] for name in SEGMENT_ORDER if merged[name])

    negatives = list(segments.negatives)
    if cinema is not None:
        negatives += cinema.negatives()
    if include_base_negatives:
        negatives += list(BASE_NEGATIVES)

    return ComposedPrompt(
        prompt=prompt,
        negative_prompt=", ".join(_dedupe(negatives)),
        segments=merged,
        motion_prompt=cinema.motion_language() if cinema is not None else "",
    )


def visual_style_suffix(
    preset_key: str | None = None,
    overrides: CinemaOverrides | None = None,
) -> str:
    """The cinema clause on its own, for callers that already have a
    prompt and only want the camera language appended.

    This is the seam the visual director uses: a niche's `visual_style`
    plus this suffix is a complete art direction, with no need to
    restructure the existing agent payload.
    """
    return resolve(preset_key, overrides).image_language()
