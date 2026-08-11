"""UGC model catalog: endpoints + per-model parameter capabilities.

Ported from the Open AI UGC studio's `MODELS` array (src/app/page.js) and
`MODEL_ENDPOINTS` map (src/app/api/generate/route.js), which were split
across the client and the server there. Keeping them in one registry is
the point: the *same* declaration drives the adaptive UI controls
(`GET /api/v1/ugc/models`) and the server-side validation that runs
before any money is spent. A model whose capabilities are only declared
client-side is a model whose parameters aren't actually validated.

Capability shapes, per model:

  aspect_ratios  — closed set; the provider 400s on anything else.
  duration       — either a closed set of allowed values (Veo 3.1 only
                   renders 8s) or an inclusive integer range.
  resolutions    — closed set, or EMPTY meaning the endpoint has no
                   resolution knob at all. Empty is enforced: passing a
                   resolution to Happy Horse / Seedance is a 400, not a
                   silently-dropped field, because the caller clearly
                   believed it was buying something it isn't.
  modes          — Grok's fun/normal/spicy content mode. Empty elsewhere.

Deviation from the source, on purpose: every default aspect ratio here is
9:16. The source defaults to landscape (16:9, and 2:3 for Grok) because
it is a general video studio; this product's UGC lane exists to produce
vertical TikTok/Reels/Shorts ads, so the vertical default is the correct
one for our UI. The *allowed* sets are ported unchanged.

Two providers, one catalog
--------------------------
The four ported models submit through `services/muapi.py`; the four
Seedance 2.5 routes submit through `services/seedance.py`, which owns its
own endpoint-per-resolution-tier map, capability table and pinned rate
card. Rather than restate those capabilities here (a second declaration
is a second thing to get wrong, and a second price table is a COGS bug
waiting to happen), the Seedance entries are DERIVED from
`seedance.SEEDANCE_MODELS` and carry an `adapter` tag that
`ugc/render.py` dispatches on and `ugc/pricing.py` delegates on. The
seam is here; neither registry is reshaped to fit the other.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from ..services import seedance


class UgcModel(BaseModel):
    """One MUAPI-backed video model and everything the UI/validator needs."""

    id: str
    name: str
    description: str
    # Upstream provider behind the MUAPI gateway (display-only).
    provider: str
    # Path appended to `settings.muapi_base_url` on submit. For a
    # seedance-adapter model this is the 720p route only — the tier is
    # part of the path upstream, so the real endpoint is resolved per
    # render by `SeedanceModel.endpoint_for(resolution)`.
    endpoint: str

    # Which provider client submits this model. `ugc/render.py` dispatches
    # on it and `ugc/pricing.py` delegates on it; everything else in the
    # studio (validation, metering, persistence, webhook/reconcile) is
    # identical for both.
    adapter: Literal["muapi", "seedance"] = "muapi"

    aspect_ratios: tuple[str, ...]
    default_aspect_ratio: str

    # Exactly one of duration_options / (duration_min, duration_max) is
    # meaningful; `duration_kind` says which, so the UI knows whether to
    # render a dropdown or a slider.
    duration_kind: Literal["options", "range"]
    duration_options: tuple[int, ...] = ()
    duration_min: int = 0
    duration_max: int = 0
    default_duration: int = 0

    # Empty tuple = this endpoint has no resolution parameter.
    resolutions: tuple[str, ...] = ()
    default_resolution: str = ""

    # Empty tuple = this endpoint has no mode parameter.
    modes: tuple[str, ...] = ()
    default_mode: str = ""

    # Reference-media arity, where the route declares one. `max_images =
    # None` means "this model states no per-model bound", which is the
    # MUAPI models' situation: they are bounded only by the studio-wide
    # MARKETER_UGC_MAX_REFERENCE_IMAGES limit. A declared 0 is a real
    # zero (the text-to-video route accepts no images at all), so the two
    # cases must not collapse into the same value.
    min_images: int = 0
    max_images: int | None = None
    # Video/audio references are declared for the UI and for agents, but
    # `POST /api/v1/ugc/renders` only carries image URLs today — the row
    # has no column for the other two. See ugc/render.py.
    max_videos: int = 0
    max_audios: int = 0
    supports_character_reference: bool = False

    # Closed set of camera-direction tokens folded into the prompt text.
    # Seedance-only; empty everywhere else.
    camera_controls: tuple[str, ...] = ()

    def allows_duration(self, seconds: int) -> bool:
        if self.duration_kind == "options":
            return seconds in self.duration_options
        return self.duration_min <= seconds <= self.duration_max

    def duration_spec(self) -> dict:
        """Serialized duration capability for the UI."""
        if self.duration_kind == "options":
            return {
                "kind": "options",
                "options": list(self.duration_options),
                "default": self.default_duration,
            }
        return {
            "kind": "range",
            "min": self.duration_min,
            "max": self.duration_max,
            "default": self.default_duration,
        }


# Ported verbatim from the source's MODELS array except for the vertical
# default noted in the module docstring.
UGC_MODELS: list[UgcModel] = [
    UgcModel(
        id="grok-video",
        name="Grok Video",
        description=(
            "xAI's Grok video model. Content modes (fun / normal / spicy) make it "
            "strong for high-CTR hooks."
        ),
        provider="xai",
        endpoint="grok-imagine-image-to-video",
        aspect_ratios=("9:16", "16:9", "2:3", "3:2", "1:1"),
        default_aspect_ratio="9:16",
        duration_kind="range",
        duration_min=6,
        duration_max=30,
        default_duration=6,
        resolutions=("480p", "720p"),
        default_resolution="480p",
        modes=("fun", "normal", "spicy"),
        default_mode="normal",
    ),
    UgcModel(
        id="veo-3-1",
        name="Veo 3.1",
        description=(
            "Google's high-fidelity model — realistic motion and lighting. Best for "
            "premium client ads. Renders a fixed 8 seconds."
        ),
        provider="google",
        endpoint="veo3.1-image-to-video",
        aspect_ratios=("16:9", "9:16"),
        default_aspect_ratio="9:16",
        duration_kind="options",
        duration_options=(8,),
        default_duration=8,
        resolutions=("720p", "1080p", "4k"),
        default_resolution="720p",
    ),
    UgcModel(
        id="happy-horse",
        name="Happy Horse 1",
        description="Fast, lifelike animation — the cheap option for batch iteration.",
        provider="happy-horse",
        # The 720p resolution is baked into the endpoint path upstream,
        # which is why this model exposes no resolution parameter.
        endpoint="happy-horse-1-image-to-video-720p",
        aspect_ratios=("16:9", "9:16", "1:1", "4:3", "3:4"),
        default_aspect_ratio="9:16",
        duration_kind="range",
        duration_min=3,
        duration_max=15,
        default_duration=5,
    ),
    UgcModel(
        id="seedance-2",
        name="Seedance 2",
        description=(
            "ByteDance's Seedance 2 — character-reference support and multi-shot "
            "generation, the best fit for multi-image UGC scripts."
        ),
        provider="bytedance",
        endpoint="seedance-2-image-to-video",
        aspect_ratios=("21:9", "16:9", "4:3", "1:1", "3:4", "9:16"),
        default_aspect_ratio="9:16",
        duration_kind="range",
        duration_min=4,
        duration_max=15,
        default_duration=5,
    ),
]


def _from_seedance(model: seedance.SeedanceModel) -> UgcModel:
    """Adapt one Seedance route into a studio catalog entry.

    Every capability is READ from the provider adapter, never restated:
    `services/seedance.py` is the authoritative source for the aspect
    ratios, duration envelope, resolution tiers, camera tokens and
    reference-media arity of these routes, and a hand-copied duplicate
    here would validate against yesterday's truth.
    """
    return UgcModel(
        id=model.id,
        name=model.name,
        description=model.tagline,
        provider="bytedance",
        endpoint=model.endpoint,
        adapter="seedance",
        aspect_ratios=model.aspect_ratios,
        default_aspect_ratio=model.default_aspect_ratio,
        # Seedance states an inclusive second range on every route.
        duration_kind="range",
        duration_min=model.duration_min,
        duration_max=model.duration_max,
        default_duration=model.default_duration,
        resolutions=model.resolutions,
        default_resolution=model.default_resolution,
        min_images=model.min_images,
        max_images=model.max_images,
        max_videos=model.max_videos,
        max_audios=model.max_audios,
        supports_character_reference=model.supports_character_reference,
        camera_controls=model.camera_controls,
    )


# The Seedance 2.5 routes are appended, not interleaved, so the ported
# source models keep their original catalog order in the UI.
UGC_MODELS.extend(_from_seedance(m) for m in seedance.list_models())

_BY_ID = {m.id: m for m in UGC_MODELS}


class UgcValidationError(ValueError):
    """A user-supplied parameter the selected model does not support.

    Raised before any provider call or spend so the route can turn it into
    a 400 rather than paying for a render the provider will reject.
    """


def get_model(model_id: str) -> UgcModel | None:
    return _BY_ID.get(model_id)


def list_models() -> list[UgcModel]:
    return list(UGC_MODELS)


def require_model(model_id: str) -> UgcModel:
    model = get_model(model_id)
    if model is None:
        known = ", ".join(sorted(_BY_ID))
        raise UgcValidationError(f"unknown model {model_id!r} (known: {known})")
    return model


def validate_params(
    model_id: str,
    *,
    aspect_ratio: str | None = None,
    duration: int | None = None,
    resolution: str | None = None,
    mode: str | None = None,
) -> dict:
    """Resolve + validate one render's parameters against a model.

    `None` (or empty) for a parameter means "use the model default"; an
    explicit value the model doesn't declare raises UgcValidationError.
    Returns the resolved settings dict, with keys omitted entirely when
    the model has no such knob — that dict is exactly what goes on the
    wire, matching the source's `...settings` spread of only the
    parameters the model actually declares.
    """
    model = require_model(model_id)
    settings: dict = {}

    ar = (aspect_ratio or "").strip() or model.default_aspect_ratio
    if ar not in model.aspect_ratios:
        raise UgcValidationError(
            f"{model.id} does not support aspect ratio {ar!r} "
            f"(supported: {', '.join(model.aspect_ratios)})"
        )
    settings["aspect_ratio"] = ar

    dur = model.default_duration if duration is None else int(duration)
    if not model.allows_duration(dur):
        if model.duration_kind == "options":
            allowed = ", ".join(str(d) for d in model.duration_options)
            detail = f"allowed: {allowed}"
        else:
            detail = f"allowed: {model.duration_min}-{model.duration_max}s"
        raise UgcValidationError(f"{model.id} does not support a {dur}s duration ({detail})")
    settings["duration"] = dur

    res = (resolution or "").strip()
    if model.resolutions:
        res = res or model.default_resolution
        if res not in model.resolutions:
            raise UgcValidationError(
                f"{model.id} does not support resolution {res!r} "
                f"(supported: {', '.join(model.resolutions)})"
            )
        settings["resolution"] = res
    elif res:
        raise UgcValidationError(f"{model.id} has no resolution parameter")

    md = (mode or "").strip()
    if model.modes:
        md = md or model.default_mode
        if md not in model.modes:
            raise UgcValidationError(
                f"{model.id} does not support mode {md!r} "
                f"(supported: {', '.join(model.modes)})"
            )
        settings["mode"] = md
    elif md:
        raise UgcValidationError(f"{model.id} has no mode parameter")

    return settings


def validate_reference_media(model_id: str, *, image_count: int) -> None:
    """Check the reference-image arity a model declares.

    Separate from `validate_params` because the image list is validated
    (count-bounded, SSRF-checked) in `ugc/render.py` rather than being one
    of the on-the-wire settings. Only models that declare a bound are
    checked: a `max_images` of None means the model states none and the
    studio-wide limit is the only ceiling.
    """
    model = require_model(model_id)
    if image_count < model.min_images:
        raise UgcValidationError(
            f"{model.id} needs at least {model.min_images} reference image(s), "
            f"got {image_count}"
        )
    if model.max_images is not None and image_count > model.max_images:
        raise UgcValidationError(
            f"{model.id} accepts at most {model.max_images} reference image(s), "
            f"got {image_count}"
        )
