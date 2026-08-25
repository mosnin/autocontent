"""Lighting, diffusion, and color-grade catalogs.

The third axis of a cinematography selection. Same rules as the other
two catalogs: pure data, prose-only phrasing.

Color grades never name a hex value. `marketer.adcreative.colors` exists
because image models print `#543cfc` into the artwork when they are
shown it; a grade is the same hazard one level up ("LUT 2383" would be
painted onto the frame as readily). Grades are therefore described by
what they do to the picture — where the shadows sit, which way the
highlights lean.
"""
from __future__ import annotations

from pydantic import BaseModel

from .film_stocks import Medium


class LightingSetup(BaseModel):
    key: str
    label: str
    phrase: str


class DiffusionFilter(BaseModel):
    key: str
    label: str
    # "none" renders to an empty phrase; the resolver drops empty
    # phrases entirely rather than emitting "no diffusion", which a
    # model reads as a *request* for the thing being negated.
    phrase: str


class ColorGrade(BaseModel):
    key: str
    label: str
    phrase: str


# Recovered from the source studio's lighting vocabulary (its
# ENHANCE_TAGS.lighting), expanded into full clauses.
LIGHTING_SETUPS: list[LightingSetup] = [
    LightingSetup(
        key="cinematic_key",
        label="Cinematic key",
        phrase="cinematic lighting with a strong key and shaped shadows",
    ),
    LightingSetup(
        key="golden_hour",
        label="Golden hour",
        phrase="low golden-hour sun raking across the frame",
    ),
    LightingSetup(
        key="dramatic_studio",
        label="Dramatic studio",
        phrase="dramatic studio lighting, hard key against deep falloff",
    ),
    LightingSetup(
        key="soft_diffused",
        label="Soft diffused",
        phrase="soft diffused light with almost no shadow edge",
    ),
    LightingSetup(
        key="neon_glow",
        label="Neon glow",
        phrase="neon practical lights glowing through the scene",
    ),
    LightingSetup(
        key="volumetric_rays",
        label="Volumetric rays",
        phrase="volumetric light rays cutting through atmosphere",
    ),
    LightingSetup(
        key="overcast_natural",
        label="Overcast natural",
        phrase="flat overcast daylight, even and unstyled",
    ),
]

DIFFUSION_FILTERS: list[DiffusionFilter] = [
    DiffusionFilter(key="none", label="None", phrase=""),
    DiffusionFilter(
        key="halation_bloom",
        label="Halation bloom",
        phrase="halation blooming around the brightest highlights",
    ),
    DiffusionFilter(
        key="black_promist",
        label="Black pro-mist",
        phrase="highlights softly bled into the shadows, micro-contrast pulled back",
    ),
    DiffusionFilter(
        key="glimmer_glass",
        label="Glimmer glass",
        phrase="a faint sparkle lifting the highlights",
    ),
    DiffusionFilter(
        key="gauze_softener",
        label="Gauze softener",
        phrase="a gauzy softness over the whole frame",
    ),
    DiffusionFilter(
        key="smoke_haze",
        label="Smoke haze",
        phrase="light haze in the air giving every beam a visible shape",
    ),
]

COLOR_GRADES: list[ColorGrade] = [
    ColorGrade(
        key="natural_color_science",
        label="Natural color science",
        phrase="natural color science and high dynamic range",
    ),
    ColorGrade(
        key="teal_orange",
        label="Teal & orange",
        phrase="a teal-and-orange grade, cool shadows against warm skin",
    ),
    ColorGrade(
        key="warm_archival",
        label="Warm archival",
        phrase="a warm archival grade, amber highlights and creamy mids",
    ),
    ColorGrade(
        key="bleach_bypass",
        label="Bleach bypass",
        phrase="a bleach-bypass grade, crushed blacks and drained saturation",
    ),
    ColorGrade(
        key="cool_silver",
        label="Cool silver",
        phrase="a cool silver grade, blue-leaning shadows and clinical whites",
    ),
    ColorGrade(
        key="muted_pastel",
        label="Muted pastel",
        phrase="a muted pastel grade, lifted blacks and low saturation",
    ),
    ColorGrade(
        key="high_contrast_mono",
        label="High-contrast mono",
        phrase="a high-contrast monochrome grade with true blacks",
    ),
]

# Quality tail the source appends to every cinema prompt. Kept as prose
# and kept LAST so it can never outrank the subject.
QUALITY_TAIL = "professional photography, ultra-detailed, high dynamic range"

# Negatives implied by the capture medium. A film selection must not be
# "cleaned up" into digital sterility, and a digital selection must not
# acquire grain the format would never produce — so the medium supplies
# its own negatives instead of the caller remembering to.
MEDIUM_NEGATIVES: dict[Medium, tuple[str, ...]] = {
    "film": ("digital sharpening artifacts", "plastic skin", "oversaturated HDR look"),
    "digital": ("heavy film grain", "dust and scratches", "gate weave"),
}

_LIGHTING_BY_KEY = {item.key: item for item in LIGHTING_SETUPS}
_DIFFUSION_BY_KEY = {item.key: item for item in DIFFUSION_FILTERS}
_GRADES_BY_KEY = {item.key: item for item in COLOR_GRADES}

DEFAULT_LIGHTING_KEY = "cinematic_key"
DEFAULT_DIFFUSION_KEY = "none"
DEFAULT_GRADE_KEY = "natural_color_science"


def get_lighting(key: str) -> LightingSetup | None:
    return _LIGHTING_BY_KEY.get(key)


def get_diffusion(key: str) -> DiffusionFilter | None:
    return _DIFFUSION_BY_KEY.get(key)


def get_grade(key: str) -> ColorGrade | None:
    return _GRADES_BY_KEY.get(key)
