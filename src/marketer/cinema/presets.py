"""Named cinematography presets and the selection resolver.

A *selection* is seven keys (capture format, lens, focal length,
aperture, lighting, diffusion, grade). A *preset* is a named, curated
selection — one-click art direction, the same product idea as
`marketer.style_presets` but on the camera axis instead of the
illustration axis. The two compose: a style preset says *what the world
looks like*, a cinema preset says *what shot it*.

`resolve()` turns a preset key plus any per-field overrides into a
`ResolvedCinema`, and `ResolvedCinema.image_language()` renders it into
the prose a model actually reads.

Why prose and not parameters
----------------------------
No *setting* reaches a prompt as a setting. Aperture never renders as
"f/1.4" and focal length never renders as "35mm", because image models
treat a parameter string as content: shown "35mm" they add 35mm film
borders and sometimes stencil the characters onto the frame, exactly as
they paint a hex color they are shown. `marketer.adcreative.colors`
already solves that case by turning `#543cfc` into "vivid violet" before
any prompt sees it, and the visual director bans text inside images for
the same reason. So the f-stop and the millimetres live in `label`
(which the UI shows) and only the *consequence* reaches the prompt: "a
natural cinematic perspective", "shallow depth of field and creamy
bokeh".

Format names are the exception and stay intact — "70mm film camera" is
the name of a medium, not a knob, and models render it as the medium.

The registry is code, not DB — like `style_presets`, these are product
content that ships and versions with the app. Per-user *saved*
selections are the DB half and live in `marketer.repos.cinema_presets`.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from . import film_stocks, grades, lenses


class UnknownCinemaKey(ValueError):
    """A selection referenced a catalog entry that does not exist.

    Raised (never silently defaulted) so a typo in an API payload fails
    loudly at the edge instead of quietly rendering the wrong look.
    """


class CinemaSelection(BaseModel):
    """A complete, resolvable choice on every cinematography axis."""

    format_key: str = film_stocks.DEFAULT_FORMAT_KEY
    lens_key: str = lenses.DEFAULT_LENS_KEY
    focal_mm: int = lenses.DEFAULT_FOCAL_MM
    aperture_key: str = lenses.DEFAULT_APERTURE_KEY
    lighting_key: str = grades.DEFAULT_LIGHTING_KEY
    diffusion_key: str = grades.DEFAULT_DIFFUSION_KEY
    grade_key: str = grades.DEFAULT_GRADE_KEY


class CinemaPreset(BaseModel):
    key: str
    label: str
    description: str
    selection: CinemaSelection


class ResolvedCinema(BaseModel):
    """A selection with every key already looked up.

    Carries the catalog objects (not keys) so the renderers below are
    pure string assembly with no further lookups — and so a caller can
    inspect exactly which entries produced the prompt.
    """

    preset_key: str | None = None
    capture_format: film_stocks.CaptureFormat
    lens: lenses.Lens
    focal: lenses.FocalLength
    aperture: lenses.Aperture
    lighting: grades.LightingSetup
    diffusion: grades.DiffusionFilter
    grade: grades.ColorGrade

    def optics_language(self) -> str:
        """Camera + glass. Feeds the composer's `camera` segment."""
        parts = [
            f"shot on {self.capture_format.phrase} with {self.lens.phrase}",
            self.focal.phrase,
            self.aperture.phrase,
            self.lens.character,
            self.capture_format.texture,
        ]
        return ", ".join(p for p in parts if p)

    def lighting_language(self) -> str:
        """Light + diffusion. Feeds the composer's `lighting` segment."""
        parts = [self.lighting.phrase, self.diffusion.phrase]
        return ", ".join(p for p in parts if p)

    def style_language(self) -> str:
        """Grade + quality tail. Feeds the composer's `style` segment,
        and is kept last so it can never outrank the subject."""
        parts = [self.grade.phrase, grades.QUALITY_TAIL]
        return ", ".join(p for p in parts if p)

    def image_language(self) -> str:
        """The whole still-frame clause. Order is fixed, so the same
        selection always renders byte-identical text."""
        parts = [
            self.optics_language(),
            self.lighting_language(),
            self.style_language(),
        ]
        return ", ".join(p for p in parts if p)

    def motion_language(self) -> str:
        """The animation clause.

        Deliberately short: the visual director requires motion prompts
        under 20 words and one move per scene, so this contributes a
        single camera behaviour, never a second subject action.
        """
        move = _MOTION_BY_LENS_FAMILY[self.lens.family]
        if self.capture_format.medium == "film":
            return f"{move}, slight film weave"
        return move

    def negatives(self) -> list[str]:
        """Negatives implied by the capture medium (film keeps its
        grain; digital does not acquire any)."""
        return list(grades.MEDIUM_NEGATIVES[self.capture_format.medium])

    def as_selection(self) -> CinemaSelection:
        return CinemaSelection(
            format_key=self.capture_format.key,
            lens_key=self.lens.key,
            focal_mm=self.focal.mm,
            aperture_key=self.aperture.key,
            lighting_key=self.lighting.key,
            diffusion_key=self.diffusion.key,
            grade_key=self.grade.key,
        )


# One camera behaviour per optics family. Anamorphic glass wants lateral
# movement (the squeeze reads on horizontal motion), macro wants almost
# none (the focus plane is paper-thin).
_MOTION_BY_LENS_FAMILY: dict[str, str] = {
    "prime": "one slow, deliberate camera move",
    "anamorphic": "a slow lateral dolly letting the frame breathe",
    "macro": "a micro push-in holding the focus plane",
    "specialty": "a slow drift revealing the plane of focus",
}


def _sel(
    format_key: str,
    lens_key: str,
    focal_mm: int,
    aperture_key: str,
    lighting_key: str,
    diffusion_key: str,
    grade_key: str,
) -> CinemaSelection:
    return CinemaSelection(
        format_key=format_key,
        lens_key=lens_key,
        focal_mm=focal_mm,
        aperture_key=aperture_key,
        lighting_key=lighting_key,
        diffusion_key=diffusion_key,
        grade_key=grade_key,
    )


# The twenty named presets, keyed exactly as the source studio's preset
# artwork is (``classic_anamorphic``, ``f_1_4``, ...). Each is a whole
# camera package built around the component it is named for, so picking
# "Classic Anamorphic" gives you a coherent shot rather than one setting
# floating on defaults.
PRESETS: list[CinemaPreset] = [
    CinemaPreset(
        key="classic_anamorphic",
        label="Classic anamorphic",
        description="Wide, flared, unmistakably cinema — the blockbuster default.",
        selection=_sel(
            "full_frame_cine_digital", "classic_anamorphic", 35, "f_1_4",
            "neon_glow", "halation_bloom", "teal_orange",
        ),
    ),
    CinemaPreset(
        key="compact_anamorphic",
        label="Compact anamorphic",
        description="Anamorphic character that survives handheld and tight sets.",
        selection=_sel(
            "studio_digital_s35", "compact_anamorphic", 35, "f_1_4",
            "neon_glow", "none", "teal_orange",
        ),
    ),
    CinemaPreset(
        key="grand_format_70mm_film",
        label="Grand format 70mm",
        description="Epic scale: enormous latitude, atmosphere, and stately moves.",
        selection=_sel(
            "grand_format_70mm_film", "classic_anamorphic", 35, "f_4",
            "volumetric_rays", "smoke_haze", "teal_orange",
        ),
    ),
    CinemaPreset(
        key="classic_16mm_film",
        label="Classic 16mm",
        description="Grainy, honest, documentary — the anti-polish look.",
        selection=_sel(
            "classic_16mm_film", "vintage_prime", 24, "f_1_4",
            "overcast_natural", "none", "muted_pastel",
        ),
    ),
    CinemaPreset(
        key="full_frame_cine_digital",
        label="Full-frame cine digital",
        description="Clean modern cinema: natural skin, deep shadows, no gimmicks.",
        selection=_sel(
            "full_frame_cine_digital", "premium_modern_prime", 35, "f_1_4",
            "cinematic_key", "none", "natural_color_science",
        ),
    ),
    CinemaPreset(
        key="studio_digital_s35",
        label="Studio digital S35",
        description="Broadcast-safe studio look — even, flattering, predictable.",
        selection=_sel(
            "studio_digital_s35", "premium_modern_prime", 50, "f_4",
            "soft_diffused", "none", "natural_color_science",
        ),
    ),
    CinemaPreset(
        key="premium_large_format_digital",
        label="Premium large format",
        description="Flagship separation and falloff for hero product and portrait.",
        selection=_sel(
            "premium_large_format_digital", "premium_modern_prime", 85, "f_1_4",
            "dramatic_studio", "glimmer_glass", "teal_orange",
        ),
    ),
    CinemaPreset(
        key="modular_8k_digital",
        label="Modular 8K digital",
        description="Maximum resolution and clarity — every texture legible.",
        selection=_sel(
            "modular_8k_digital", "clinical_sharp_prime", 50, "f_4",
            "dramatic_studio", "none", "cool_silver",
        ),
    ),
    CinemaPreset(
        key="premium_modern_prime",
        label="Premium modern prime",
        description="Neutral, expensive-looking glass that never editorializes.",
        selection=_sel(
            "premium_large_format_digital", "premium_modern_prime", 50, "f_4",
            "soft_diffused", "none", "natural_color_science",
        ),
    ),
    CinemaPreset(
        key="warm_cinema_prime",
        label="Warm cinema prime",
        description="Golden, forgiving, nostalgic — flattering on faces.",
        selection=_sel(
            "full_frame_cine_digital", "warm_cinema_prime", 50, "f_1_4",
            "golden_hour", "black_promist", "warm_archival",
        ),
    ),
    CinemaPreset(
        key="vintage_prime",
        label="Vintage prime",
        description="Soft corners and blooming highlights: memory, not document.",
        selection=_sel(
            "classic_16mm_film", "vintage_prime", 50, "f_1_4",
            "golden_hour", "halation_bloom", "warm_archival",
        ),
    ),
    CinemaPreset(
        key="70s_cinema_prime",
        label="70s cinema prime",
        description="Period flare and warmth — New Hollywood on a big negative.",
        selection=_sel(
            "grand_format_70mm_film", "70s_cinema_prime", 35, "f_4",
            "golden_hour", "halation_bloom", "warm_archival",
        ),
    ),
    CinemaPreset(
        key="clinical_sharp_prime",
        label="Clinical sharp prime",
        description="Product-ad crispness: no aberration, no romance.",
        selection=_sel(
            "modular_8k_digital", "clinical_sharp_prime", 50, "f_11",
            "dramatic_studio", "none", "cool_silver",
        ),
    ),
    CinemaPreset(
        key="swirl_bokeh_portrait",
        label="Swirl bokeh portrait",
        description="Petzval swirl behind a razor-sharp face — dreamlike portraiture.",
        selection=_sel(
            "full_frame_cine_digital", "swirl_bokeh_portrait", 85, "f_1_4",
            "soft_diffused", "gauze_softener", "muted_pastel",
        ),
    ),
    CinemaPreset(
        key="halation_diffusion",
        label="Halation diffusion",
        description="Highlights that bleed and glow — neon, night, nostalgia.",
        selection=_sel(
            "full_frame_cine_digital", "halation_diffusion", 50, "f_1_4",
            "neon_glow", "halation_bloom", "teal_orange",
        ),
    ),
    CinemaPreset(
        key="creative_tilt_lens",
        label="Creative tilt lens",
        description="A tilted focus plane: one sliver sharp, the world melting.",
        selection=_sel(
            "full_frame_cine_digital", "creative_tilt_lens", 50, "f_1_4",
            "cinematic_key", "none", "muted_pastel",
        ),
    ),
    CinemaPreset(
        key="extreme_macro",
        label="Extreme macro",
        description="Life-size detail with paper-thin focus — texture as subject.",
        selection=_sel(
            "modular_8k_digital", "extreme_macro", 85, "f_1_4",
            "dramatic_studio", "none", "natural_color_science",
        ),
    ),
    CinemaPreset(
        key="f_1_4",
        label="Wide open (f/1.4)",
        description="Maximum subject separation: creamy bokeh, everything else gone.",
        selection=_sel(
            "full_frame_cine_digital", "premium_modern_prime", 85, "f_1_4",
            "soft_diffused", "none", "natural_color_science",
        ),
    ),
    CinemaPreset(
        key="f_4",
        label="Balanced (f/4)",
        description="Subject clean and separated with the setting still readable.",
        selection=_sel(
            "studio_digital_s35", "premium_modern_prime", 35, "f_4",
            "cinematic_key", "none", "natural_color_science",
        ),
    ),
    CinemaPreset(
        key="f_11",
        label="Deep focus (f/11)",
        description="Sharp front to back — landscape, architecture, group shots.",
        selection=_sel(
            "premium_large_format_digital", "clinical_sharp_prime", 24, "f_11",
            "overcast_natural", "none", "natural_color_science",
        ),
    ),
]

_BY_KEY = {p.key: p for p in PRESETS}

DEFAULT_SELECTION = CinemaSelection()
PRESET_KEYS: tuple[str, ...] = tuple(p.key for p in PRESETS)


def get_preset(key: str) -> CinemaPreset | None:
    return _BY_KEY.get(key)


class CinemaOverrides(BaseModel):
    """Per-field overrides layered on top of a preset (or the default).

    Every field is optional: `None` means "keep whatever the preset
    said". This is what lets the UI offer a preset picker *and* a custom
    combination builder against the same resolver.
    """

    format_key: str | None = None
    lens_key: str | None = None
    focal_mm: int | None = Field(default=None, ge=1, le=2000)
    aperture_key: str | None = None
    lighting_key: str | None = None
    diffusion_key: str | None = None
    grade_key: str | None = None


def resolve(
    preset_key: str | None = None,
    overrides: CinemaOverrides | None = None,
) -> ResolvedCinema:
    """Look up every key in a selection, applying overrides on top.

    Raises `UnknownCinemaKey` for any key the catalogs don't contain.
    `focal_mm` is the one forgiving field: any integer snaps to the
    nearest catalogued focal length, because a UI slider (or an agent)
    can legitimately produce 45mm and describing it as "standard
    portrait perspective" beats refusing the request.
    """
    if preset_key is None:
        base = DEFAULT_SELECTION
    else:
        preset = get_preset(preset_key)
        if preset is None:
            raise UnknownCinemaKey(f"unknown cinema preset: {preset_key}")
        base = preset.selection

    ov = overrides or CinemaOverrides()
    format_key = ov.format_key or base.format_key
    lens_key = ov.lens_key or base.lens_key
    focal_mm = ov.focal_mm if ov.focal_mm is not None else base.focal_mm
    aperture_key = ov.aperture_key or base.aperture_key
    lighting_key = ov.lighting_key or base.lighting_key
    diffusion_key = ov.diffusion_key or base.diffusion_key
    grade_key = ov.grade_key or base.grade_key

    capture_format = film_stocks.get_format(format_key)
    if capture_format is None:
        raise UnknownCinemaKey(f"unknown capture format: {format_key}")
    lens = lenses.get_lens(lens_key)
    if lens is None:
        raise UnknownCinemaKey(f"unknown lens: {lens_key}")
    aperture = lenses.get_aperture(aperture_key)
    if aperture is None:
        raise UnknownCinemaKey(f"unknown aperture: {aperture_key}")
    lighting = grades.get_lighting(lighting_key)
    if lighting is None:
        raise UnknownCinemaKey(f"unknown lighting setup: {lighting_key}")
    diffusion = grades.get_diffusion(diffusion_key)
    if diffusion is None:
        raise UnknownCinemaKey(f"unknown diffusion filter: {diffusion_key}")
    grade = grades.get_grade(grade_key)
    if grade is None:
        raise UnknownCinemaKey(f"unknown color grade: {grade_key}")

    return ResolvedCinema(
        preset_key=preset_key,
        capture_format=capture_format,
        lens=lens,
        focal=lenses.nearest_focal_length(focal_mm),
        aperture=aperture,
        lighting=lighting,
        diffusion=diffusion,
        grade=grade,
    )


def preview(preset: CinemaPreset) -> str:
    """The prompt language a preset contributes — what the picker shows
    under the preset name so the choice is inspectable before spending."""
    return resolve(preset.key).image_language()


def _validate_registry() -> None:
    """Fail at import if any preset points at a missing catalog entry.

    A dangling key would otherwise surface as a 500 the first time a
    user picked that preset; here it breaks CI instead.
    """
    for preset in PRESETS:
        resolve(preset.key)


_validate_registry()
