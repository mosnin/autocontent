"""Optics catalog: lenses, focal lengths, apertures.

Pure data + pure functions. No I/O, no DB, no network — the pipeline
imports this at module scope, so anything that could block or fail
belongs somewhere else.

Every entry carries a `phrase`: the *prose* an image or video model
should read, not the parameter that produced it. Diffusion/lens/aperture
values are settings, and generative models happily paint settings they
are shown — the same failure mode `marketer.adcreative.colors` exists to
prevent, where a raw `#543cfc` ends up printed on a button in the
artwork. So the catalog never emits "aperture=f/1.4"; it emits
"a wide-open aperture with shallow depth of field and creamy bokeh".
The numeric identity survives in `label`, which the UI shows and the
prompt never sees.

Keys are the slugs used by the source studio's preset artwork
(``f_1_4``, ``classic_anamorphic``, ...) so a UI can map a catalog entry
to its thumbnail without a translation table.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

LensFamily = Literal["prime", "anamorphic", "macro", "specialty"]


class Lens(BaseModel):
    key: str
    label: str
    family: LensFamily
    # Prose the model reads, e.g. "a classic anamorphic lens".
    phrase: str
    # What the glass *does* to the picture — the part that actually
    # changes the render. Rendered as a parenthetical after `phrase`.
    character: str
    # Focal length this glass is most often used at; the resolver falls
    # back to it when a selection doesn't pin one.
    default_focal_mm: int


class FocalLength(BaseModel):
    mm: int
    label: str
    # Perspective compression/expansion in words. "35mm" alone means
    # nothing to a diffusion model; "a natural cinematic perspective"
    # does.
    phrase: str


class Aperture(BaseModel):
    key: str
    label: str
    phrase: str


# The eleven optics the source studio ships, recovered verbatim from its
# LENS_MAP and its preset artwork. Order is the picker order: it is part
# of the product, and the composer's determinism depends on it.
LENSES: list[Lens] = [
    Lens(
        key="premium_modern_prime",
        label="Premium Modern Prime",
        family="prime",
        phrase="a premium modern prime lens",
        character="clean contrast, neutral rendering, gentle falloff",
        default_focal_mm=35,
    ),
    Lens(
        key="warm_cinema_prime",
        label="Warm Cinema Prime",
        family="prime",
        phrase="a warm-toned cinema prime lens",
        character="golden highlight rolloff, forgiving skin tones",
        default_focal_mm=50,
    ),
    Lens(
        key="vintage_prime",
        label="Vintage Prime",
        family="prime",
        phrase="a vintage prime lens",
        character="lower contrast, soft corners, blooming highlights",
        default_focal_mm=50,
    ),
    Lens(
        key="70s_cinema_prime",
        label="70s Cinema Prime",
        family="prime",
        phrase="a 1970s cinema prime lens",
        character="warm cast, veiling flare, period-correct softness",
        default_focal_mm=35,
    ),
    Lens(
        key="clinical_sharp_prime",
        label="Clinical Sharp Prime",
        family="prime",
        phrase="an ultra-sharp clinical prime lens",
        character="edge-to-edge resolution, no aberration, product-ad crispness",
        default_focal_mm=50,
    ),
    Lens(
        key="classic_anamorphic",
        label="Classic Anamorphic",
        family="anamorphic",
        phrase="a classic anamorphic lens",
        character="oval bokeh, horizontal blue flares, wide squeezed frame",
        default_focal_mm=35,
    ),
    Lens(
        key="compact_anamorphic",
        label="Compact Anamorphic",
        family="anamorphic",
        phrase="a compact anamorphic lens",
        character="restrained oval bokeh, subtle streak flare, handheld-friendly",
        default_focal_mm=35,
    ),
    Lens(
        key="swirl_bokeh_portrait",
        label="Swirl Bokeh Portrait",
        family="specialty",
        phrase="a swirl-bokeh portrait lens",
        character="petzval-style swirling background, sharp centre, dreamy edges",
        default_focal_mm=85,
    ),
    Lens(
        key="halation_diffusion",
        label="Halation Diffusion",
        family="specialty",
        phrase="a diffusion filter on the lens",
        character="halation glow bleeding around highlights, softened micro-contrast",
        default_focal_mm=50,
    ),
    Lens(
        key="creative_tilt_lens",
        label="Creative Tilt Lens",
        family="specialty",
        phrase="a tilt-shift lens",
        character="a tilted plane of focus, a sliver sharp and the rest melting away",
        default_focal_mm=50,
    ),
    Lens(
        key="extreme_macro",
        label="Extreme Macro",
        family="macro",
        phrase="an extreme macro lens",
        character="life-size magnification, paper-thin focus, texture you can feel",
        default_focal_mm=85,
    ),
]

# The six focal lengths the source exposes. `mm` is the identity; the
# phrase is what reaches the model.
FOCAL_LENGTHS: list[FocalLength] = [
    FocalLength(mm=8, label="8mm", phrase="an ultra-wide fisheye perspective"),
    FocalLength(mm=14, label="14mm", phrase="a wide-angle perspective"),
    FocalLength(mm=24, label="24mm", phrase="a wide-angle dynamic perspective"),
    FocalLength(mm=35, label="35mm", phrase="a natural cinematic perspective"),
    FocalLength(mm=50, label="50mm", phrase="a standard portrait perspective"),
    FocalLength(mm=85, label="85mm", phrase="a classic compressed portrait perspective"),
]

APERTURES: list[Aperture] = [
    Aperture(
        key="f_1_4",
        label="f/1.4",
        phrase="a wide-open aperture with shallow depth of field and creamy bokeh",
    ),
    Aperture(
        key="f_4",
        label="f/4",
        phrase="a balanced depth of field with the subject cleanly separated",
    ),
    Aperture(
        key="f_11",
        label="f/11",
        phrase="deep focus clarity, sharp from foreground to background",
    ),
]

_LENSES_BY_KEY = {item.key: item for item in LENSES}
_APERTURES_BY_KEY = {item.key: item for item in APERTURES}
_FOCALS_BY_MM = {item.mm: item for item in FOCAL_LENGTHS}

DEFAULT_LENS_KEY = "premium_modern_prime"
DEFAULT_APERTURE_KEY = "f_1_4"
DEFAULT_FOCAL_MM = 35


def get_lens(key: str) -> Lens | None:
    return _LENSES_BY_KEY.get(key)


def get_aperture(key: str) -> Aperture | None:
    return _APERTURES_BY_KEY.get(key)


def get_focal_length(mm: int) -> FocalLength | None:
    return _FOCALS_BY_MM.get(mm)


def nearest_focal_length(mm: int) -> FocalLength:
    """The catalogued focal length closest to `mm`.

    A UI slider (or an agent) can hand us any integer; rather than
    rejecting 45mm we describe it with the nearest vocabulary we have.
    Ties break toward the shorter lens, which keeps the result stable
    for any given input.
    """
    return min(FOCAL_LENGTHS, key=lambda f: (abs(f.mm - mm), f.mm))
