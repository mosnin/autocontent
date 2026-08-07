"""Brand colors as words, never as hex.

Handed a raw code like `#543cfc`, image models cheerfully print the
string "#543cfc" onto a button in the artwork. So every brand color is
converted to a plain-English phrase ("vivid purple", "deep navy") before
it can reach a prompt, and the HARD RULES in `concepts.py` forbid
printing color names too. Hex survives only in the Brief's stored
palette, which the UI shows and the prompt never sees.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_BRAND_COLOR = re.compile(r"^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$", re.IGNORECASE)

# Used when a styleguide yields no usable palette, or only grays: a
# confident default beats an ad that hedges into beige.
FALLBACK_COLOR_A = "vivid violet"
FALLBACK_COLOR_B = "deep navy"


@dataclass(frozen=True, slots=True)
class Hsl:
    h: float
    s: float
    l: float


def normalize_brand_color_hex(value: str) -> str | None:
    """The canonical CSS hex form accepted throughout an Ad Run."""
    raw = (value or "").strip()
    if not _BRAND_COLOR.match(raw):
        return None
    return f"#{raw.lstrip('#').lower()}"


def hex_to_hsl(value: str) -> Hsl | None:
    normalized = normalize_brand_color_hex(value)
    if normalized is None:
        return None
    raw = normalized[1:]
    full = "".join(c * 2 for c in raw) if len(raw) == 3 else raw
    n = int(full[:6], 16)
    r = ((n >> 16) & 255) / 255
    g = ((n >> 8) & 255) / 255
    b = (n & 255) / 255
    high = max(r, g, b)
    low = min(r, g, b)
    lightness = (high + low) / 2
    delta = high - low
    hue = 0.0
    saturation = 0.0
    if delta > 0:
        saturation = delta / (1 - abs(2 * lightness - 1))
        if high == r:
            hue = ((g - b) / delta + (6 if g < b else 0)) * 60
        elif high == g:
            hue = ((b - r) / delta + 2) * 60
        else:
            hue = ((r - g) / delta + 4) * 60
    return Hsl(h=hue, s=saturation * 100, l=lightness * 100)


def _hue_name(h: float, lightness: float) -> str:
    if h < 15:
        return "red"
    if h < 40:
        return "orange"
    if h < 55:
        return "amber"
    if h < 70:
        return "yellow"
    if h < 90:
        return "lime green"
    if h < 150:
        return "green"
    if h < 175:
        return "teal"
    if h < 200:
        return "cyan"
    if h < 235:
        return "navy" if lightness < 32 else "blue"
    if h < 260:
        return "indigo"
    if h < 285:
        return "violet"
    if h < 310:
        return "purple"
    if h < 335:
        return "magenta"
    return "pink"


def describe_color(value: str) -> str:
    """One hex code -> one prompt-safe phrase."""
    hsl = hex_to_hsl(value)
    if hsl is None:
        return FALLBACK_COLOR_B
    if hsl.s < 10:
        if hsl.l < 12:
            return "near-black"
        if hsl.l < 30:
            return "charcoal"
        if hsl.l < 55:
            return "slate gray"
        if hsl.l < 82:
            return "soft gray"
        return "off-white"
    hue = _hue_name(hsl.h, hsl.l)
    if hue == "navy":
        return "deep navy"
    if hsl.l < 25:
        return f"deep {hue}"
    if hsl.l > 80:
        return f"pale {hue}"
    if hsl.s > 70 and 38 <= hsl.l <= 66:
        return f"vivid {hue}"
    if hsl.s > 40:
        return f"rich {hue}"
    return f"muted {hue}"


def pick_brand_colors(hexes: list[str]) -> tuple[str, str]:
    """Two workhorse brand colors as phrases.

    The dominant is the most vivid, mid-brightness color in the palette;
    the second is the highest-scoring color that is *visibly* different
    from it (30 degrees of hue apart, or 25 points of lightness), because
    two near-identical blues make an ad that reads as one flat wash.
    """
    scored = []
    for value in hexes:
        hsl = hex_to_hsl(value)
        if hsl is None:
            continue
        scored.append((hsl.s - abs(hsl.l - 50), value, hsl))
    scored.sort(key=lambda entry: entry[0], reverse=True)

    if not scored:
        return FALLBACK_COLOR_A, FALLBACK_COLOR_B

    _, first_hex, first_hsl = scored[0]
    second: tuple[float, str, Hsl] | None = None
    for candidate in scored[1:]:
        delta_h = abs(candidate[2].h - first_hsl.h)
        hue_distance = min(delta_h, 360 - delta_h)
        if hue_distance >= 30 or abs(candidate[2].l - first_hsl.l) >= 25:
            second = candidate
            break
    if second is None and len(scored) > 1:
        second = scored[1]

    return (
        describe_color(first_hex),
        describe_color(second[1]) if second is not None else FALLBACK_COLOR_B,
    )
