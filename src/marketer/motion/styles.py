"""Motion-graphic style catalog + the style bake-off.

A `MotionStyle` is one art direction expressed in two coordinated halves:

* **typography** — font, size ratio, colors, casing, position, and the
  animation the kinetic text uses (consumed by `motion/overlays`);
* **art direction** — the collage idiom, palette and print finish that
  go into every generated b-roll keyframe prompt, plus the stock-footage
  bias for the `stock` sourcing strategy.

The idioms, palettes and finishes are ported from the source project's
`styles.py` (`STYLE_LIBRARY` + `THEME_PRESETS`), collapsed into a single
flat record because this product needs *one* key on the wire, not a
theme that dereferences an idiom.

Why the bake-off renders cheap proxies first
--------------------------------------------
Committing a whole project to a style costs one image-model call per
beat, at production quality. Getting the look wrong means paying for all
of them twice. The bake-off renders ONE representative beat in each
candidate style at the cheapest quality the model offers, so the choice
is made against real pixels for roughly the price of a single beat
instead of a whole render. Selection itself is deterministic (see
`pick_winner`) so the same brief always resolves to the same style — a
random pick would make failed renders unreproducible.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from pydantic import BaseModel, Field

# The catalog registry is code, not DB — same reasoning as
# `marketer.style_presets`: presets are product content that ships and
# versions with the app.


class MotionStyle(BaseModel):
    key: str
    label: str
    description: str
    # One line the picker renders in the style's own voice, so a user can
    # see the typographic treatment without a render.
    type_preview: str

    # --- typography -------------------------------------------------
    font: str = "Arial Black"
    # Fraction of the canvas short side. 0.062 * 1080 ~= 67px on 9:16.
    font_scale: float = 0.062
    text_hex: str = "FFFFFF"
    outline_hex: str = "101010"
    uppercase: bool = True
    position: str = "bottom"
    animation: str = "rise"
    box: bool = False
    box_hex: str = "000000"
    box_alpha: float = 0.55
    line_max_chars: int = 22
    # 'block' = a wrapped headline per beat; 'word' = one popped word at
    # a time (punchier, longer filter chain).
    overlay_mode: str = "block"
    # Burn the existing word-level ASS captions (services/subtitle.py)
    # underneath the kinetic layer. Off for word-mode styles, which would
    # otherwise render the same words twice.
    word_captions: bool = True

    # --- art direction ----------------------------------------------
    idiom: str
    palette: str
    finish: str
    # Bias applied to stock-footage search terms for this style.
    stock_bias: str = ""
    swatch: str = "linear-gradient(135deg, #444, #999)"

    # Keywords that make this style a good fit for a brief. Used by the
    # deterministic bake-off scorer.
    affinities: tuple[str, ...] = Field(default=())


COLLAGE_MECHANICS = (
    "Clearly layered hand-cut paper cut-outs with visible torn and scissor-cut edges, "
    "tape corners and soft real paper drop shadows on a bold flat paper background. "
    "Halftone print dots, slight print misregistration, scattered geometric paper "
    "accents. Printed and illustrated, never a 3D render — keep print grain and paper "
    "imperfections."
)

# No readable headline is baked into the image: the kinetic type layer is
# burned on afterwards and doubled typography looks like a mistake.
NO_BAKED_TEXT = (
    "No readable text, headlines, captions, logos or watermarks anywhere in the image — "
    "any newspaper scraps carry unreadable blurred micro-text only."
)

STYLES: dict[str, MotionStyle] = {
    "modern-flat": MotionStyle(
        key="modern-flat",
        label="Explainer flat",
        description=(
            "The Vox-explainer look: bold flat-color vector cut-outs, a limited "
            "contemporary palette, crisp editorial layout. Type rises into the "
            "lower third in tight caps."
        ),
        type_preview="TIGHT CAPS · RISING LOWER THIRD",
        font="Arial Black",
        font_scale=0.060,
        text_hex="FFFFFF",
        outline_hex="12161F",
        animation="rise",
        position="bottom",
        line_max_chars=24,
        idiom=(
            "Clean modern flat 2D illustrated collage in the explainer motion-graphic "
            "style: bold flat-color vector-illustration cut-outs, simple confident "
            "shapes, crisp infographic editorial layout."
        ),
        palette="limited contemporary palette — ink navy, warm red, bone white",
        finish="clean flat color, very subtle paper grain",
        stock_bias="clean minimal editorial",
        swatch="linear-gradient(135deg, #2f4f8f, #d94f3d)",
        affinities=("explainer", "how", "why", "data", "guide", "tutorial", "science"),
    ),
    "american-retro": MotionStyle(
        key="american-retro",
        label="American retro",
        description=(
            "1950s-60s advertising and pulp-magazine paper collage. Heavy wood-type "
            "caps slam in over halftone dots and aged newsprint."
        ),
        type_preview="HEAVY SLAB CAPS · PUNCHY SLAM-IN",
        font="Impact",
        font_scale=0.066,
        text_hex="FFF3D6",
        outline_hex="2A1608",
        animation="pop",
        position="bottom",
        line_max_chars=20,
        idiom=(
            "Vintage 1950s-60s American advertising and pulp-magazine paper collage: "
            "bold flat retro colors, mid-century engraved and illustrated cut-out "
            "figures, classic Americana printed imagery, nostalgic."
        ),
        palette="bold retro primaries — red, mustard, teal, cream",
        finish="heavy halftone dots, aged newsprint, slight misregistration",
        stock_bias="vintage retro americana",
        swatch="linear-gradient(135deg, #d1452f, #e8b53c)",
        affinities=("nostalgia", "history", "brand", "story", "classic", "food"),
    ),
    "swiss-modern": MotionStyle(
        key="swiss-modern",
        label="Swiss modern",
        description=(
            "Two colors, one red accent, a lot of white. Grotesque caps slide in "
            "from the edge and sit still — precision over energy."
        ),
        type_preview="Akzidenz caps · sliding, precise",
        font="Helvetica",
        font_scale=0.054,
        text_hex="111111",
        outline_hex="FFFFFF",
        uppercase=False,
        animation="slide",
        position="top",
        box=True,
        box_hex="FFFFFF",
        box_alpha=0.88,
        line_max_chars=26,
        idiom=(
            "Swiss International Style graphic composition: flat two-color shapes "
            "with one red accent, generous white space, strict grid, photographic "
            "cut-outs used sparingly."
        ),
        palette="two-color plus one red accent, lots of white",
        finish="clean flat ink, very subtle grain",
        stock_bias="minimal architectural geometric",
        swatch="linear-gradient(135deg, #f5f5f5, #e02020)",
        affinities=("finance", "b2b", "product", "design", "precision", "report"),
    ),
    "punk-zine": MotionStyle(
        key="punk-zine",
        label="Punk zine",
        description=(
            "Ransom-note collage: photocopied halftone, one fluorescent spot color, "
            "mismatched cut-out letters. One word at a time, hard cuts, no fades."
        ),
        type_preview="RANSOM CUT-OUTS · ONE WORD AT A TIME",
        font="Impact",
        font_scale=0.078,
        text_hex="F5FF3D",
        outline_hex="0A0A0A",
        animation="pop",
        position="center",
        overlay_mode="word",
        word_captions=False,
        line_max_chars=14,
        idiom=(
            "Gritty punk zine / ransom-note collage: torn newspaper and magazine "
            "scraps, photocopied high-contrast halftone, black-and-white with one "
            "fluorescent spot color, raw hand-cut edges. DIY, analog, urgent."
        ),
        palette="black and white plus one fluorescent spot color",
        finish="photocopy grain, heavy misregistration",
        stock_bias="gritty urban high contrast",
        swatch="linear-gradient(135deg, #111, #f5ff3d)",
        affinities=("rant", "hot take", "controversy", "music", "youth", "hustle"),
    ),
    "newsprint-editorial": MotionStyle(
        key="newsprint-editorial",
        label="Newsprint editorial",
        description=(
            "A mid-century front page brought to life: cut-out photographs over a "
            "broadsheet, heavy halftone, condensed headline caps."
        ),
        type_preview="CONDENSED BROADSHEET HEADLINE",
        font="Arial Black",
        font_scale=0.058,
        text_hex="FAF6EC",
        outline_hex="1B1B1B",
        animation="rise",
        position="bottom",
        box=True,
        box_hex="17181C",
        box_alpha=0.62,
        line_max_chars=26,
        idiom=(
            "Vintage newsprint editorial collage in the style of a mid-century "
            "front-page news feature: bold cut-out photographs and illustrations "
            "laid over a broadsheet newspaper page, tactile cinematic editorial "
            "energy — reads like a newspaper feature spread, not an ad."
        ),
        palette="cream white, deep red, mustard yellow, charcoal black",
        finish="aged paper, heavy halftone dots, high contrast, slight misregistration",
        stock_bias="documentary journalistic archival",
        swatch="linear-gradient(135deg, #efe7d4, #8e1b12)",
        affinities=("news", "investigation", "politics", "timeline", "case", "report"),
    ),
    "gilded-deco": MotionStyle(
        key="gilded-deco",
        label="Gilded deco",
        description=(
            "1920s art-deco press page: aged cream paper, champagne-gold foil, thin "
            "geometric frames. Type fades up slowly, wide and calm."
        ),
        type_preview="Wide Didone · slow fade-up",
        font="Georgia",
        font_scale=0.050,
        text_hex="F4E7C6",
        outline_hex="1E1A12",
        uppercase=False,
        animation="fade",
        position="center",
        line_max_chars=28,
        idiom=(
            "Vintage luxury editorial paper collage, 1920s art-deco advertisement "
            "mood: aged cream paper with visible grain, champagne-gold foil accents, "
            "thin art-deco geometric line frames and gilded arches. Hushed, opulent, "
            "museum-vitrine calm."
        ),
        palette="aged cream, champagne gold, charcoal black, muted deep gold",
        finish="gold foil, aged paper grain, fine halftone, slight misregistration",
        stock_bias="luxury elegant slow motion",
        swatch="linear-gradient(135deg, #efe3c2, #b8912f)",
        affinities=("luxury", "beauty", "fashion", "wine", "travel", "craft"),
    ),
    "atomic-age": MotionStyle(
        key="atomic-age",
        label="Atomic age",
        description=(
            "1950s retro-futurism: starbursts, teal and orange, optimistic geometry. "
            "Type pops in on the beat."
        ),
        type_preview="GEOMETRIC CAPS · POP ON THE BEAT",
        font="Arial Black",
        font_scale=0.064,
        text_hex="FFFFFF",
        outline_hex="0E3A46",
        animation="pop",
        position="bottom",
        line_max_chars=22,
        idiom=(
            "1950s atomic-age retro-futurist illustrated collage: starbursts, "
            "boomerang shapes, stylized optimistic machinery, printed cut-out figures."
        ),
        palette="teal, orange, cream",
        finish="halftone, starbursts, flat screenprint ink",
        stock_bias="retro futuristic technology",
        swatch="linear-gradient(135deg, #128b9b, #f07422)",
        affinities=("tech", "future", "ai", "startup", "gadget", "space"),
    ),
    "photo-collage": MotionStyle(
        key="photo-collage",
        label="Photo collage",
        description=(
            "Cinematic documentary photo-collage: archival black-and-white cut-outs, "
            "one restrained accent color. Type fades in low and quiet."
        ),
        type_preview="Quiet sentence case · slow fade",
        font="Helvetica",
        font_scale=0.048,
        text_hex="FFFFFF",
        outline_hex="000000",
        uppercase=False,
        animation="fade",
        position="bottom",
        line_max_chars=30,
        idiom=(
            "Cinematic documentary photo-collage: real black-and-white archival "
            "photographs cut out and layered with soft drop shadows, one restrained "
            "accent color, sepia and monochrome vintage photography. Serious, "
            "editorial, museum-like."
        ),
        palette="monochrome and sepia with one restrained accent",
        finish="archival photographic grain, soft paper shadows",
        stock_bias="documentary cinematic archival",
        swatch="linear-gradient(135deg, #6b6259, #cfc6b8)",
        affinities=("biography", "history", "documentary", "people", "essay"),
    ),
}

DEFAULT_STYLE_KEY = "modern-flat"
# Sentinel accepted by the API: run the bake-off instead of trusting a key.
AUTO_STYLE_KEY = "auto"

# Candidates the bake-off renders. Four is the practical ceiling: the
# proxies are cheap but not free, and a user cannot meaningfully compare
# more than four looks side by side.
BAKEOFF_CANDIDATES: tuple[str, ...] = (
    "modern-flat",
    "american-retro",
    "punk-zine",
    "newsprint-editorial",
)
# Proxy render settings — the cheapest gpt-image-1 tier and a square
# frame, because we are judging palette/finish, not composition.
BAKEOFF_QUALITY = "low"
BAKEOFF_SIZE = "1024x1024"

_WORD = re.compile(r"[a-z0-9]+")


class UnknownStyle(KeyError):
    """Raised for a style key that is not in the catalog."""


def get_style(key: str | None) -> MotionStyle:
    """Look up a style, falling back to the default for None/'auto'."""
    if not key or key == AUTO_STYLE_KEY:
        return STYLES[DEFAULT_STYLE_KEY]
    try:
        return STYLES[key]
    except KeyError as e:
        raise UnknownStyle(key) from e


def catalog() -> list[dict]:
    """The wire shape for `GET /api/v1/motion/styles`."""
    return [
        {
            "key": s.key,
            "label": s.label,
            "description": s.description,
            "preview": {
                "type_preview": s.type_preview,
                "font": s.font,
                "uppercase": s.uppercase,
                "position": s.position,
                "animation": s.animation,
                "text_hex": s.text_hex,
                "outline_hex": s.outline_hex,
                "swatch": s.swatch,
                "overlay_mode": s.overlay_mode,
            },
            "palette": s.palette,
            "finish": s.finish,
        }
        for s in STYLES.values()
    ]


def keyframe_prompt(style: MotionStyle, beat_text: str, *, aspect: str = "9:16") -> str:
    """Art-directed b-roll keyframe prompt for one beat.

    Port of the source project's `compose_collage_prompt`, minus the
    title cartouche: this pipeline burns its own kinetic type on top, so
    the image must stay text-free (see NO_BAKED_TEXT).
    """
    scene = " ".join((beat_text or "").split())[:400]
    return (
        f"{style.idiom} Palette: {style.palette}. Print finish: {style.finish}. "
        f"{COLLAGE_MECHANICS} "
        f"SCENE (as layered cut-outs): {scene}. "
        f"One clear focal subject, strong editorial poster balance. "
        f"{NO_BAKED_TEXT} Aspect ratio {aspect}."
    )


def stock_query(style: MotionStyle, keyword: str) -> str:
    """Bias a raw b-roll keyword toward the project's look."""
    keyword = " ".join((keyword or "").split())[:60]
    return f"{keyword} {style.stock_bias}".strip()


# ---------------------------------------------------------------------------
# Bake-off
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BakeoffCandidate:
    """One proxy render request: a style key plus the exact cheap call."""

    style_key: str
    prompt: str
    quality: str = BAKEOFF_QUALITY
    size: str = BAKEOFF_SIZE

    def as_dict(self) -> dict:
        return {"style_key": self.style_key, "quality": self.quality, "size": self.size}


def plan_bakeoff(
    beat_text: str,
    *,
    candidates: tuple[str, ...] | list[str] | None = None,
    aspect: str = "9:16",
) -> list[BakeoffCandidate]:
    """Proxy render plan for ONE representative beat, one call per style.

    Pure: returns what to render, never renders it. The caller pays for
    `len(candidates)` cheap images — bounded by construction because the
    candidate list is a fixed catalog subset, not user input.
    """
    keys = [k for k in (candidates or BAKEOFF_CANDIDATES) if k in STYLES]
    return [
        BakeoffCandidate(
            style_key=key,
            prompt=keyframe_prompt(STYLES[key], beat_text, aspect=aspect),
        )
        for key in keys
    ]


def score_style(style: MotionStyle, brief: str) -> float:
    """Deterministic affinity of a style for a brief (higher is better).

    Word-overlap against the style's declared affinities, normalised by
    the number of affinities so a style with a long list isn't favoured
    automatically. No model call: the bake-off already spends money on
    pixels, and a second LLM judge would make the same choice
    non-reproducible for no extra signal.
    """
    if not style.affinities:
        return 0.0
    tokens = set(_WORD.findall((brief or "").lower()))
    if not tokens:
        return 0.0
    hits = sum(1 for a in style.affinities if a in tokens)
    return round(hits / len(style.affinities), 6)


def pick_winner(candidate_keys: list[str], brief: str) -> str:
    """Choose the bake-off winner: best affinity, catalog order breaks ties.

    Deterministic on purpose — a failed render must be reproducible with
    the same inputs, and an operator must be able to explain why a
    project came out in a given look.
    """
    keys = [k for k in candidate_keys if k in STYLES]
    if not keys:
        return DEFAULT_STYLE_KEY
    order = list(STYLES)
    return max(keys, key=lambda k: (score_style(STYLES[k], brief), -order.index(k)))
