"""marketer.sh Studio: server-side generation for every studio surface.

The Studio UI never calls a generation vendor and never holds a vendor
key. It POSTs {kind, model, params} to our API, we persist a
``studio_generations`` row, and this module drives that row to a terminal
state through OUR provider layer — with our spend caps, our SSRF policy,
and a spend_ledger row for every cent.

Routing (model class -> provider implementation)
------------------------------------------------
==================  =========================  ==============================
model class          provider implementation    ledger provider / SKU
==================  =========================  ==============================
broad catalog        fal queue API (here)       "fal" / catalog model id
 (image, video,
  lipsync, v2v,
  recast)
GPT image models     services.openai_images     "openai" / gpt-image-1
Grok Imagine video   services.grok_imagine      "xai" / grok-imagine-video
ElevenLabs speech    services.elevenlabs_tts    "elevenlabs" / model id
OpenAI speech        services.openai_tts        "openai" / gpt-4o-mini-tts
ElevenLabs music     services.music_gen         "elevenlabs" / music
==================  =========================  ==============================

The fal path is a generic submit -> poll -> fetch against the same queue
contract ``fal_video`` has proven (POST ``queue.fal.run/{endpoint}`` ->
``{request_id, status_url, response_url}``, poll the status url until
COMPLETED, GET the response url for outputs), with the same retry
predicate and backoff. It is generic rather than reusing
``fal_video.animate`` because the studio catalog spans text-to-image
through video-to-video, and its inputs arrive as URLs (uploaded to our
object storage) rather than local keyframe files.

Spend
-----
Every generation runs under a ``SpendContext``:

* ``ensure_can_spend(estimate)`` runs BEFORE any provider call, so a
  generation that would breach a niche/global cap or exhaust prepaid
  credit is refused fail-closed without spending anything;
* ``log(...)`` records provider + model SKU + units + USD after the call,
  which re-reads the ledger and trips the context if the cap was crossed;
* delegated providers (image/audio/Grok) do both themselves — we wrap the
  context's recorder so the generation row still learns the exact cost.

Studio spend is niche-less: global caps and prepaid credit apply,
per-niche caps do not. Rows carry ``studio_generation_id`` so spend joins
back to the generation that caused it.

Pricing is a curated registry (fal's published unit prices at integration
time), correctable per model without a deploy through the existing
``MARKETER_FAL_PRICE_OVERRIDES``. Additional catalog entries can be
registered by an operator through ``MARKETER_STUDIO_MODEL_REGISTRY_EXTRA``
— a model we have no confirmed provider path for is never faked; it is
absent from the catalog and requesting it fails with a typed error that
says exactly that.
"""
from __future__ import annotations

import asyncio
import json
import mimetypes
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

import httpx
from pydantic import BaseModel, ValidationError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..logging import get_logger
from ..models import SpendEntry, StudioGeneration
from ..repos import media as media_repo
from ..repos import studio as studio_repo
from . import object_storage, provider_limits, ssrf
from .spend_context import SpendContext, default_context

log = get_logger(__name__)

FAL_QUEUE_BASE = "https://queue.fal.run"
HTTP_TIMEOUT_SEC = 60.0
POLL_INTERVAL_SEC = 4.0
# Per-kind ceilings on how long we wait for a queued job. Video-class
# renders legitimately take many minutes; an image should never.
POLL_TIMEOUT_SEC: dict[str, float] = {
    "image": 300.0,
    "audio": 600.0,
    "video": 1800.0,
    "lipsync": 1800.0,
    "video2video": 1800.0,
    "recast": 1800.0,
}
DEFAULT_POLL_TIMEOUT_SEC = 900.0

# Ceiling on a single generation's params blob. The row is persisted and
# replayed; an unbounded prompt/URL list is a cheap way to bloat the table.
MAX_PARAMS_BYTES = 64_000

# Studio outputs land in the media library so they get the same durable
# storage, retention, and auth-scoped playback as pipeline artifacts.
_LIBRARY_KIND = {"image": "keyframe", "video": "clip", "audio": "voiceover"}


# ---------------------------------------------------------------------------
# Typed errors. Each one is surfaced to the user as a failed generation with
# an explanatory message — never a stub that pretends the work happened.
# ---------------------------------------------------------------------------


class StudioGenError(RuntimeError):
    """Base class for every studio generation failure."""


class UnknownStudioModel(StudioGenError):
    """The requested model is not in the catalog."""


class UnsupportedModelClass(StudioGenError):
    """The catalog has no provider path we can actually run for this class
    of model (e.g. a studio whose models are not available through any
    provider we integrate)."""


class ProviderNotConfigured(StudioGenError):
    """The provider this model routes to has no credentials configured."""


class InvalidStudioParams(StudioGenError):
    """The submitted params are missing something required, carry an
    unsupported key, or are too large."""


class UnsafeInputURL(StudioGenError):
    """A user-supplied URL failed the SSRF check."""


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

StudioKind = Literal["image", "video", "audio", "lipsync", "video2video", "recast"]
Provider = Literal["fal", "openai", "xai", "elevenlabs"]
Unit = Literal["image", "second", "character"]

# Params we accept per kind and forward to the provider verbatim. Anything
# outside this set is rejected rather than silently dropped — a param the
# user believed applied but that never reached the model is worse than a
# clear error.
_KIND_PARAMS: dict[str, tuple[str, ...]] = {
    "image": (
        "prompt", "negative_prompt", "image_size", "aspect_ratio", "num_images",
        "seed", "image_url", "images_list", "strength",
    ),
    "video": (
        "prompt", "negative_prompt", "image_url", "images_list", "last_image",
        "aspect_ratio", "resolution", "seed",
    ),
    "audio": ("text", "voice", "voice_id", "mood", "style_directions"),
    "lipsync": ("video_url", "audio_url", "image_url", "prompt", "resolution", "seed"),
    "video2video": (
        "video_url", "image_url", "prompt", "aspect_ratio", "resolution", "seed", "scale",
    ),
    "recast": (
        "video_url", "image_url", "prompt", "aspect_ratio", "resolution", "seed",
        "character_orientation",
    ),
}

# Every param that may carry a user-supplied URL. Each is SSRF-checked
# before it reaches a provider, whether it came from our upload endpoint or
# was pasted by the user.
_URL_PARAMS = frozenset(
    {"image_url", "video_url", "audio_url", "last_image", "images_list", "video_files"}
)

# Params the caller sets that we consume rather than forward.
_OUR_PARAMS = frozenset({"duration_sec", "quality"})


class StudioModel(BaseModel):
    """One catalog entry.

    ``id`` is what the UI sends and what the ledger records as the SKU; it
    is the real vendor/provider model identifier, not a name of ours.
    """

    id: str
    name: str
    kind: StudioKind
    provider: Provider
    # Provider-side path. For fal this is the queue endpoint; for delegated
    # providers it is unused (their own module owns the endpoint).
    endpoint: str = ""
    unit: Unit
    usd_per_unit: Decimal
    output_kind: Literal["image", "video", "audio"]
    required_params: tuple[str, ...] = ()
    # Duration handling for per-second models. `allowed_durations` snaps a
    # requested length to the endpoint's enum (arbitrary integers 400 on
    # most fal video endpoints); `duration_suffix` is "" for the bare
    # integer form and "s" for endpoints whose enum carries the unit.
    allowed_durations: tuple[int, ...] = ()
    duration_suffix: str = ""
    default_duration_sec: int = 5
    # True when the output length is set by an INPUT the provider reads
    # (lip sync follows the video, speech follows the text) rather than by
    # a duration knob. Those models require the caller to declare
    # `duration_sec` so the cap check has something real to gate on.
    duration_from_input: bool = False
    max_duration_sec: int = 60
    # Extra request fields the endpoint requires.
    extra_body: dict[str, Any] = {}
    # Matching entry in the UI model catalog (web/lib/studio/catalog). The
    # UI builds its controls from that entry's `inputs` schema; "" means we
    # have no schema for this model and the UI uses its generic controls.
    catalog_id: str = ""


# Curated catalog. Prices are the vendor's published unit prices at
# integration time; correct drift with MARKETER_FAL_PRICE_OVERRIDES rather
# than a deploy.
STUDIO_MODELS: list[StudioModel] = [
    # --- Image -----------------------------------------------------------
    StudioModel(
        id="fal-ai/flux/schnell",
        catalog_id="flux-schnell",
        name="FLUX.1 [schnell]",
        kind="image",
        provider="fal",
        endpoint="fal-ai/flux/schnell",
        unit="image",
        usd_per_unit=Decimal("0.003"),
        output_kind="image",
        required_params=("prompt",),
    ),
    StudioModel(
        id="fal-ai/flux/dev",
        catalog_id="flux-dev",
        name="FLUX.1 [dev]",
        kind="image",
        provider="fal",
        endpoint="fal-ai/flux/dev",
        unit="image",
        usd_per_unit=Decimal("0.025"),
        output_kind="image",
        required_params=("prompt",),
    ),
    StudioModel(
        id="fal-ai/flux-pro/v1.1",
        name="FLUX1.1 [pro]",
        kind="image",
        provider="fal",
        endpoint="fal-ai/flux-pro/v1.1",
        unit="image",
        usd_per_unit=Decimal("0.04"),
        output_kind="image",
        required_params=("prompt",),
    ),
    StudioModel(
        id="fal-ai/flux/dev/image-to-image",
        name="FLUX.1 [dev] image-to-image",
        kind="image",
        provider="fal",
        endpoint="fal-ai/flux/dev/image-to-image",
        unit="image",
        usd_per_unit=Decimal("0.025"),
        output_kind="image",
        required_params=("prompt", "image_url"),
    ),
    StudioModel(
        id="gpt-image-1",
        name="GPT Image 1",
        kind="image",
        provider="openai",
        unit="image",
        # Priced per size/quality tier by openai_pricing; this is the
        # portrait/medium tier used for the pre-flight estimate.
        usd_per_unit=Decimal("0.063"),
        output_kind="image",
        required_params=("prompt",),
    ),
    # --- Video -----------------------------------------------------------
    StudioModel(
        id="fal-ai/veo3",
        catalog_id="veo3-text-to-video",
        name="Veo 3",
        kind="video",
        provider="fal",
        endpoint="fal-ai/veo3",
        unit="second",
        usd_per_unit=Decimal("0.40"),
        output_kind="video",
        required_params=("prompt",),
        allowed_durations=(8,),
        duration_suffix="s",
        default_duration_sec=8,
        max_duration_sec=8,
        extra_body={"generate_audio": False},
    ),
    StudioModel(
        id="fal-ai/veo3/fast",
        catalog_id="veo3-fast-text-to-video",
        name="Veo 3 Fast",
        kind="video",
        provider="fal",
        endpoint="fal-ai/veo3/fast",
        unit="second",
        usd_per_unit=Decimal("0.10"),
        output_kind="video",
        required_params=("prompt",),
        allowed_durations=(8,),
        duration_suffix="s",
        default_duration_sec=8,
        max_duration_sec=8,
        extra_body={"generate_audio": False},
    ),
    StudioModel(
        id="fal-ai/minimax/hailuo-02/standard/text-to-video",
        catalog_id="minimax-hailuo-02-standard-t2v",
        name="Hailuo 02 Standard (text-to-video)",
        kind="video",
        provider="fal",
        endpoint="fal-ai/minimax/hailuo-02/standard/text-to-video",
        unit="second",
        usd_per_unit=Decimal("0.045"),
        output_kind="video",
        required_params=("prompt",),
        allowed_durations=(6, 10),
        default_duration_sec=6,
        max_duration_sec=10,
    ),
    StudioModel(
        id="fal-ai/wan/v2.2-a14b/text-to-video",
        catalog_id="wan2.2-text-to-video",
        name="Wan 2.2 (14B) text-to-video",
        kind="video",
        provider="fal",
        endpoint="fal-ai/wan/v2.2-a14b/text-to-video",
        unit="second",
        usd_per_unit=Decimal("0.04"),
        output_kind="video",
        required_params=("prompt",),
        allowed_durations=(5, 8),
        default_duration_sec=5,
        max_duration_sec=8,
    ),
    StudioModel(
        id="fal-ai/kling-video/v2.1/standard/image-to-video",
        catalog_id="kling-v2.1-standard-i2v",
        name="Kling 2.1 Standard (image-to-video)",
        kind="video",
        provider="fal",
        endpoint="fal-ai/kling-video/v2.1/standard/image-to-video",
        unit="second",
        usd_per_unit=Decimal("0.05"),
        output_kind="video",
        required_params=("prompt", "image_url"),
        allowed_durations=(5, 10),
        default_duration_sec=5,
        max_duration_sec=10,
    ),
    StudioModel(
        id="fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
        catalog_id="kling-v2.5-turbo-pro-i2v",
        name="Kling 2.5 Turbo Pro (image-to-video)",
        kind="video",
        provider="fal",
        endpoint="fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
        unit="second",
        usd_per_unit=Decimal("0.07"),
        output_kind="video",
        required_params=("prompt", "image_url"),
        allowed_durations=(5, 10),
        default_duration_sec=5,
        max_duration_sec=10,
    ),
    StudioModel(
        id="grok-imagine-video",
        catalog_id="grok-imagine-text-to-video",
        name="Grok Imagine",
        kind="video",
        provider="xai",
        unit="second",
        usd_per_unit=Decimal("0.050"),
        output_kind="video",
        required_params=("prompt", "image_url"),
        allowed_durations=tuple(range(1, 16)),
        default_duration_sec=5,
        max_duration_sec=15,
    ),
    # --- Lip sync --------------------------------------------------------
    StudioModel(
        id="fal-ai/sync-lipsync",
        catalog_id="sync-lipsync",
        name="sync.so lipsync",
        kind="lipsync",
        provider="fal",
        endpoint="fal-ai/sync-lipsync",
        unit="second",
        usd_per_unit=Decimal("0.05"),
        output_kind="video",
        required_params=("video_url", "audio_url"),
        duration_from_input=True,
        max_duration_sec=600,
    ),
    StudioModel(
        id="fal-ai/latentsync",
        catalog_id="latent-sync",
        name="LatentSync",
        kind="lipsync",
        provider="fal",
        endpoint="fal-ai/latentsync",
        unit="second",
        usd_per_unit=Decimal("0.05"),
        output_kind="video",
        required_params=("video_url", "audio_url"),
        duration_from_input=True,
        max_duration_sec=600,
    ),
    # --- Video-to-video --------------------------------------------------
    StudioModel(
        id="fal-ai/video-upscaler",
        catalog_id="ai-video-upscaler",
        name="Video Upscaler",
        kind="video2video",
        provider="fal",
        endpoint="fal-ai/video-upscaler",
        unit="second",
        usd_per_unit=Decimal("0.02"),
        output_kind="video",
        required_params=("video_url",),
        duration_from_input=True,
        max_duration_sec=600,
    ),
    # --- Audio -----------------------------------------------------------
    StudioModel(
        id="elevenlabs-tts",
        name="ElevenLabs speech",
        kind="audio",
        provider="elevenlabs",
        unit="character",
        usd_per_unit=Decimal("0.00015"),
        output_kind="audio",
        required_params=("text",),
    ),
    StudioModel(
        id="gpt-4o-mini-tts",
        name="OpenAI speech",
        kind="audio",
        provider="openai",
        unit="character",
        usd_per_unit=Decimal("0.000015"),
        output_kind="audio",
        required_params=("text",),
    ),
    StudioModel(
        id="elevenlabs-music",
        name="ElevenLabs music",
        kind="audio",
        provider="elevenlabs",
        unit="second",
        usd_per_unit=Decimal("0.00833"),
        output_kind="audio",
        required_params=("mood",),
        default_duration_sec=30,
        max_duration_sec=300,
    ),
]


def _registry_extra() -> list[StudioModel]:
    """Operator-registered catalog entries, parsed per call.

    ``MARKETER_STUDIO_MODEL_REGISTRY_EXTRA`` holds a JSON array of
    ``StudioModel`` objects, so a studio whose models we have no built-in
    entry for (recast, for instance) can be enabled against a provider
    path we already run without a code deploy. Malformed config is dropped
    — never break generation over a registry knob — but logged loudly,
    because a silently ignored entry means a model the operator believes
    is live is a 404 to every user.
    """
    raw = settings.studio_model_registry_extra
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning(
            "studio registry: MARKETER_STUDIO_MODEL_REGISTRY_EXTRA is not valid JSON, "
            "ignoring",
            extra={"error": str(exc)},
        )
        return []
    if not isinstance(parsed, list):
        log.warning(
            "studio registry: expected a JSON array, got %s, ignoring",
            type(parsed).__name__,
        )
        return []
    out: list[StudioModel] = []
    for item in parsed:
        try:
            out.append(StudioModel.model_validate(item))
        except (ValidationError, TypeError) as exc:
            log.warning(
                "studio registry: dropping unparseable model entry",
                extra={"error": str(exc)},
            )
    return out


def _fal_price_overrides() -> dict[str, Decimal]:
    """Reuse the existing fal price-override channel so studio models and
    pipeline models are corrected the same way, from the same place."""
    raw = settings.fal_price_overrides
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, Decimal] = {}
    for key, val in parsed.items():
        try:
            price = Decimal(str(val))
        except (InvalidOperation, ValueError):
            continue
        if price > 0:
            out[str(key)] = price
    return out


def catalog() -> list[StudioModel]:
    """The live catalog: built-in entries plus operator-registered ones,
    with price overrides applied. Later entries win on id collision so an
    operator can correct a built-in outright."""
    by_id: dict[str, StudioModel] = {m.id: m for m in STUDIO_MODELS}
    for extra in _registry_extra():
        by_id[extra.id] = extra
    overrides = _fal_price_overrides()
    models: list[StudioModel] = []
    for model in by_id.values():
        price = overrides.get(model.id)
        if price is not None and price != model.usd_per_unit:
            model = model.model_copy(update={"usd_per_unit": price})
        models.append(model)
    return models


def get_model(model_id: str) -> StudioModel | None:
    return next((m for m in catalog() if m.id == model_id), None)


def models_for_kind(kind: str) -> list[StudioModel]:
    return [m for m in catalog() if m.kind == kind]


def resolve_model(kind: str, model_id: str) -> StudioModel:
    """The catalog lookup every entry point goes through.

    Raises ``UnknownStudioModel`` for an id we do not carry and
    ``UnsupportedModelClass`` when the whole kind has no runnable model —
    the honest answer when a studio's models are not reachable through any
    provider we integrate. Neither case ever falls back to a different
    model: silently substituting one would spend the user's money on
    something they did not ask for.
    """
    model = get_model(model_id)
    if model is not None and model.kind == kind:
        return model
    if not models_for_kind(kind):
        raise UnsupportedModelClass(
            f"no {kind} model is available: this studio's models are not "
            "reachable through any provider we currently run. An operator can "
            "register one through MARKETER_STUDIO_MODEL_REGISTRY_EXTRA."
        )
    if model is None:
        raise UnknownStudioModel(f"unknown studio model {model_id!r}")
    raise UnknownStudioModel(
        f"model {model_id!r} is a {model.kind} model, not {kind}"
    )


def provider_enabled(model: StudioModel) -> bool:
    if model.provider == "fal":
        return bool(settings.fal_api_key)
    if model.provider == "openai":
        return bool(settings.openai_api_key)
    if model.provider == "xai":
        return bool(settings.xai_api_key)
    if model.provider == "elevenlabs":
        return bool(settings.elevenlabs_api_key)
    return False


def _require_provider(model: StudioModel) -> None:
    if not provider_enabled(model):
        raise ProviderNotConfigured(
            f"{model.name} routes to the {model.provider} provider, which has "
            "no API key configured on this deployment"
        )


# ---------------------------------------------------------------------------
# Param validation, SSRF, cost
# ---------------------------------------------------------------------------


def _url_values(params: dict) -> list[str]:
    urls: list[str] = []
    for key in _URL_PARAMS:
        val = params.get(key)
        if isinstance(val, str) and val:
            urls.append(val)
        elif isinstance(val, list):
            urls.extend([v for v in val if isinstance(v, str) and v])
    return urls


async def check_input_urls(params: dict) -> None:
    """Reject any user-supplied URL that is not a public https endpoint.

    Studio inputs are fetched (or dereferenced) server-side, so an
    unchecked URL is a straight SSRF: loopback, RFC1918, or the cloud
    metadata endpoint. The DNS resolution is blocking, so it runs off the
    event loop.
    """
    for url in _url_values(params):
        ok, reason = await asyncio.to_thread(ssrf.check_public_url, url)
        if not ok:
            raise UnsafeInputURL(f"input url rejected: {reason}")


def validate_params(model: StudioModel, params: dict) -> dict:
    """Normalize + validate the submitted params against the model.

    Returns the params we will persist and run. Unsupported keys are an
    error rather than a silent drop, and required inputs are checked here
    so a missing reference image fails before anything is spent.
    """
    if not isinstance(params, dict):
        raise InvalidStudioParams("params must be an object")
    encoded = json.dumps(params, default=str)
    if len(encoded) > MAX_PARAMS_BYTES:
        raise InvalidStudioParams(
            f"params are {len(encoded)} bytes, over the {MAX_PARAMS_BYTES}-byte limit"
        )

    allowed = set(_KIND_PARAMS.get(model.kind, ())) | _OUR_PARAMS
    unsupported = sorted(set(params) - allowed)
    if unsupported:
        raise InvalidStudioParams(
            f"{model.name} does not accept: {', '.join(unsupported)}"
        )

    missing = [p for p in model.required_params if not params.get(p)]
    if missing:
        raise InvalidStudioParams(
            f"{model.name} requires: {', '.join(missing)}"
        )

    clean = {k: v for k, v in params.items() if v is not None}

    if model.unit == "second":
        clean["duration_sec"] = _resolve_duration(model, clean.get("duration_sec"))
    return clean


def _resolve_duration(model: StudioModel, requested: Any) -> int:
    """The length we price and (where the endpoint has a knob) request.

    Models whose length comes from an input (lip sync follows the source
    video) have no knob, so the caller must declare the input's length:
    without it the cap check would have nothing real to gate on, and
    guessing would either under-charge the ledger or refuse valid work.
    """
    if requested is None:
        if model.duration_from_input:
            raise InvalidStudioParams(
                f"{model.name} renders for as long as its input media, so "
                "duration_sec (the input's length in seconds) is required to "
                "check it against your spend cap"
            )
        return model.default_duration_sec
    try:
        seconds = int(round(float(requested)))
    except (TypeError, ValueError):
        raise InvalidStudioParams(f"duration_sec must be a number, got {requested!r}")
    if seconds < 1:
        raise InvalidStudioParams("duration_sec must be at least 1 second")
    if seconds > model.max_duration_sec:
        raise InvalidStudioParams(
            f"{model.name} renders at most {model.max_duration_sec}s, got {seconds}s"
        )
    if model.allowed_durations:
        seconds = min(model.allowed_durations, key=lambda d: abs(d - seconds))
    return seconds


def estimate_cost(model: StudioModel, params: dict) -> Decimal:
    """Pre-flight USD estimate — what the cap check gates on.

    Deliberately never optimistic: an under-estimate would let a
    generation start that the cap should have refused.
    """
    if model.unit == "image":
        count = params.get("num_images") or 1
        try:
            n = max(1, int(count))
        except (TypeError, ValueError):
            n = 1
        if model.provider == "openai":
            from .openai_pricing import image_cost

            quality = str(params.get("quality") or "medium")
            size = str(params.get("image_size") or _openai_size(params))
            try:
                return image_cost(quality, n, size=size)
            except ValueError as exc:
                raise InvalidStudioParams(str(exc)) from exc
        return (model.usd_per_unit * Decimal(n)).quantize(Decimal("0.000001"))
    if model.unit == "character":
        text = str(params.get("text") or "")
        return (model.usd_per_unit * Decimal(len(text))).quantize(Decimal("0.000001"))
    seconds = _resolve_duration(model, params.get("duration_sec"))
    return (model.usd_per_unit * Decimal(seconds)).quantize(Decimal("0.000001"))


def _openai_size(params: dict) -> str:
    """Map an aspect ratio onto a gpt-image-1 size. Unknown ratios fall
    back to the portrait size the rest of the product renders."""
    from .openai_images import SIZE_9_16

    return {
        "1:1": "1024x1024",
        "16:9": "1536x1024",
        "9:16": SIZE_9_16,
    }.get(str(params.get("aspect_ratio") or ""), SIZE_9_16)


# ---------------------------------------------------------------------------
# fal queue transport (submit -> poll -> fetch)
# ---------------------------------------------------------------------------


def _is_retryable(exc: BaseException) -> bool:
    """Same predicate as ``fal_video``: retry rate limits, 5xx, and
    transport faults; never a deterministic 4xx, which fails identically
    on every attempt."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.HTTPError)


def _fal_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SEC,
        headers={"Authorization": f"Key {settings.fal_api_key}"},
    )


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _fal_submit(client: httpx.AsyncClient, endpoint: str, body: dict) -> dict:
    # As in fal_video: a retry here only fires for a transport fault or a
    # 429/5xx, never for a request fal rejected, so it cannot re-submit
    # something already accepted except in the narrow case where the POST
    # landed and only the response was lost. fal's queue API has no
    # client-supplied idempotency key, so that residual risk cannot be
    # closed from here.
    resp = await client.post(f"{FAL_QUEUE_BASE}/{endpoint}", json=body)
    resp.raise_for_status()
    out = resp.json()
    if not out.get("status_url") or not out.get("response_url"):
        raise StudioGenError(f"queue response missing urls: {out!r}")
    return out


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _fal_poll_once(client: httpx.AsyncClient, status_url: str) -> dict:
    resp = await client.get(status_url)
    resp.raise_for_status()
    return resp.json()


async def _fal_await_completion(
    client: httpx.AsyncClient, status_url: str, *, timeout_sec: float
) -> None:
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_sec
    while True:
        body = await _fal_poll_once(client, status_url)
        status = body.get("status")
        if status == "COMPLETED":
            return
        if status in ("FAILED", "CANCELLED", "ERROR"):
            raise StudioGenError(f"provider request {status}: {body!r}")
        if loop.time() >= deadline:
            raise StudioGenError(f"provider request timed out after {timeout_sec}s")
        await asyncio.sleep(POLL_INTERVAL_SEC)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _download(client: httpx.AsyncClient, url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".part")
    async with client.stream("GET", url) as resp:
        resp.raise_for_status()
        with tmp_path.open("wb") as fp:
            async for chunk in resp.aiter_bytes():
                fp.write(chunk)
    tmp_path.replace(out_path)


def _result_urls(result: dict) -> list[str]:
    """Pull output URLs out of a completed provider payload.

    Endpoints differ in shape — ``{"images": [{"url": …}]}``,
    ``{"video": {"url": …}}``, ``{"audio": {"url": …}}``, or a bare
    ``{"url": …}`` — so we accept the shapes the queue actually returns
    instead of assuming one.
    """
    urls: list[str] = []

    def _take(value: Any) -> None:
        if isinstance(value, str) and value:
            urls.append(value)
        elif isinstance(value, dict):
            url = value.get("url")
            if isinstance(url, str) and url:
                urls.append(url)
        elif isinstance(value, list):
            for item in value:
                _take(item)

    for key in ("images", "image", "video", "videos", "audio", "output", "url"):
        if key in result:
            _take(result[key])
    return urls


def _build_fal_body(model: StudioModel, params: dict) -> dict:
    body: dict[str, Any] = {
        k: v for k, v in params.items() if k in _KIND_PARAMS.get(model.kind, ())
    }
    if model.unit == "second" and model.allowed_durations:
        seconds = _resolve_duration(model, params.get("duration_sec"))
        body["duration"] = f"{seconds}{model.duration_suffix}"
    body.update(model.extra_body)
    return body


@dataclass
class ProviderRun:
    """What a provider path produced: local files plus what it cost."""

    files: list[Path] = field(default_factory=list)
    provider_request_id: str | None = None
    billed_seconds: float | None = None


# ---------------------------------------------------------------------------
# Provider paths
# ---------------------------------------------------------------------------


async def _run_fal(
    model: StudioModel, params: dict, *, work_dir: Path, spend: SpendContext
) -> ProviderRun:
    estimate = estimate_cost(model, params)
    await spend.ensure_can_spend(estimate)

    body = _build_fal_body(model, params)
    timeout = POLL_TIMEOUT_SEC.get(model.kind, DEFAULT_POLL_TIMEOUT_SEC)
    suffix = {"image": ".png", "video": ".mp4", "audio": ".mp3"}[model.output_kind]

    async with _fal_client() as client:
        async with provider_limits.slot("fal"):
            queued = await _fal_submit(client, model.endpoint, body)
            request_id = queued.get("request_id")
            await _fal_await_completion(
                client, queued["status_url"], timeout_sec=timeout
            )
            resp = await client.get(queued["response_url"])
            resp.raise_for_status()
            result = resp.json()

        urls = _result_urls(result)
        if not urls:
            raise StudioGenError(
                f"{model.name} completed but returned no output url: {result!r}"
            )
        files: list[Path] = []
        for i, url in enumerate(urls):
            out_path = work_dir / f"output_{i}{suffix}"
            await _download(client, url, out_path)
            files.append(out_path)

    # Bill what the provider says it rendered when it says so, else the
    # length we requested — same policy as the pipeline's fal renders.
    billed_seconds: float | None = None
    if model.unit == "second":
        reported = result.get("video", {}).get("duration") if isinstance(
            result.get("video"), dict
        ) else None
        billed_seconds = float(reported or params["duration_sec"])
        cost = (model.usd_per_unit * Decimal(str(billed_seconds))).quantize(
            Decimal("0.000001")
        )
    else:
        cost = estimate
    await spend.log(
        provider="fal",
        sku=model.id,
        units=Decimal(str(billed_seconds)) if billed_seconds else Decimal(len(files)),
        cost_usd=cost,
    )
    return ProviderRun(
        files=files, provider_request_id=request_id, billed_seconds=billed_seconds
    )


async def _run_openai_image(
    model: StudioModel, params: dict, *, work_dir: Path, spend: SpendContext
) -> ProviderRun:
    """GPT image models. openai_images owns the cap check and the ledger
    row; we only decide how many images and at what size."""
    from . import openai_images

    quality = str(params.get("quality") or "medium")
    size = str(params.get("image_size") or _openai_size(params))
    try:
        count = max(1, int(params.get("num_images") or 1))
    except (TypeError, ValueError):
        count = 1

    files: list[Path] = []
    async with provider_limits.slot("openai_images"):
        for i in range(count):
            out_path = work_dir / f"output_{i}.png"
            await openai_images.generate_keyframe(
                str(params["prompt"]),
                out_path,
                quality=quality,
                size=size,
                spend=spend,
            )
            files.append(out_path)
    return ProviderRun(files=files)


async def _run_grok_video(
    model: StudioModel, params: dict, *, work_dir: Path, spend: SpendContext
) -> ProviderRun:
    """Grok Imagine animates a reference image, so the (already
    SSRF-checked) image_url is fetched to a local file first."""
    from . import grok_imagine

    keyframe = work_dir / "reference.png"
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SEC) as client:
        await _download(client, str(params["image_url"]), keyframe)

    out_path = work_dir / "output_0.mp4"
    seconds = _resolve_duration(model, params.get("duration_sec"))
    async with provider_limits.slot("grok"):
        await grok_imagine.animate(
            keyframe,
            str(params["prompt"]),
            out_path,
            duration_sec=float(seconds),
            aspect_ratio=str(params.get("aspect_ratio") or "9:16"),
            spend=spend,
        )
    return ProviderRun(files=[out_path], billed_seconds=float(seconds))


async def _run_audio(
    model: StudioModel, params: dict, *, work_dir: Path, spend: SpendContext
) -> ProviderRun:
    """Speech and music. Each underlying service owns its own cap check
    and ledger row."""
    if model.id == "elevenlabs-music":
        from . import music_gen

        out_path = work_dir / "output_0.mp3"
        seconds = _resolve_duration(model, params.get("duration_sec"))
        async with provider_limits.slot("elevenlabs"):
            await music_gen.compose(
                mood=str(params["mood"]),
                duration_sec=seconds,
                out_path=out_path,
                spend=spend,
            )
        return ProviderRun(files=[out_path], billed_seconds=float(seconds))

    out_path = work_dir / "output_0.wav"
    if model.id == "elevenlabs-tts":
        from . import elevenlabs_tts

        async with provider_limits.slot("elevenlabs"):
            await elevenlabs_tts.synthesize(
                str(params["text"]),
                out_path,
                voice_id=str(params.get("voice_id") or ""),
                spend=spend,
            )
        return ProviderRun(files=[out_path])

    if model.id == "gpt-4o-mini-tts":
        from . import openai_tts

        async with provider_limits.slot("openai_tts"):
            await openai_tts.synthesize(
                str(params["text"]),
                out_path,
                voice=str(params.get("voice") or openai_tts.DEFAULT_VOICE),
                style_directions=params.get("style_directions"),
                spend=spend,
            )
        return ProviderRun(files=[out_path])

    raise UnsupportedModelClass(
        f"{model.id!r} is an audio model with no provider path implemented"
    )


async def _dispatch(
    model: StudioModel, params: dict, *, work_dir: Path, spend: SpendContext
) -> ProviderRun:
    """The routing table itself: model class -> provider implementation."""
    if model.provider == "fal":
        return await _run_fal(model, params, work_dir=work_dir, spend=spend)
    if model.provider == "openai" and model.output_kind == "image":
        return await _run_openai_image(model, params, work_dir=work_dir, spend=spend)
    if model.provider == "xai":
        return await _run_grok_video(model, params, work_dir=work_dir, spend=spend)
    if model.output_kind == "audio":
        return await _run_audio(model, params, work_dir=work_dir, spend=spend)
    raise UnsupportedModelClass(
        f"{model.name} routes to {model.provider!r}, which has no implementation "
        f"for {model.output_kind} output"
    )


# ---------------------------------------------------------------------------
# Output persistence
# ---------------------------------------------------------------------------


async def _store_outputs(
    *, user_id: str, generation_id: UUID, model: StudioModel, files: list[Path]
) -> list[dict]:
    """Index each produced file in the media library and return the output
    descriptors the API hands back.

    Object storage is used when configured (durable + presigned playback);
    otherwise the file stays on the artifacts volume and playback goes
    through the library's own auth-scoped endpoint. Either way the URL the
    UI receives is one only the owner can use.
    """
    outputs: list[dict] = []
    for index, path in enumerate(files):
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if object_storage.enabled():
            storage = "wasabi"
            key = f"users/{user_id}/studio/{generation_id}/{path.name}"
            await object_storage.upload_file(path, key)
        else:
            storage, key = "volume", str(path)
        asset = await media_repo.record_asset(
            user_id=user_id,
            kind=_LIBRARY_KIND[model.output_kind],
            storage=storage,
            object_key=key,
            content_type=content_type,
            size_bytes=path.stat().st_size if path.exists() else 0,
            title=f"Studio: {model.name} #{index + 1}",
        )
        if storage == "wasabi":
            url = await object_storage.presigned_get_url(key)
        else:
            url = f"/api/v1/library/{asset.id}/media"
        outputs.append(
            {
                "url": url,
                "kind": model.output_kind,
                "content_type": content_type,
                "asset_id": str(asset.id),
            }
        )
    return outputs


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def work_dir_for(user_id: str, generation_id: UUID) -> Path:
    return Path(settings.artifacts_dir) / user_id / "studio" / str(generation_id)


async def preflight(*, user_id: str, kind: str, model_id: str, params: dict) -> dict:
    """Everything we can check before persisting a generation row: the
    model exists, its provider is configured, the params are usable, the
    URLs are safe, and the estimated cost fits under the caps.

    Raises the typed error for the first problem found — including
    ``SpendCapExceeded``, so the API refuses fail-closed at submit time
    instead of queueing work that is guaranteed to be refused.
    """
    model = resolve_model(kind, model_id)
    _require_provider(model)
    clean = validate_params(model, params)
    await check_input_urls(clean)
    estimate = estimate_cost(model, clean)
    spend = await default_context(
        user_id=user_id, niche_id=None, job_id=None, cap_usd=None
    )
    await spend.ensure_can_spend(estimate)
    return clean


async def _recording_context(user_id: str, generation_id: UUID) -> tuple[
    SpendContext, list[SpendEntry]
]:
    """A SpendContext that also tells us what the generation cost.

    Delegated providers (images, speech, music, Grok) log their own ledger
    rows, so wrapping the recorder is how the generation row learns its
    true cost without duplicating any pricing logic.
    """
    spend = await default_context(
        user_id=user_id,
        niche_id=None,
        job_id=None,
        studio_generation_id=generation_id,
        cap_usd=None,
    )
    entries: list[SpendEntry] = []
    inner = spend.record

    async def _record(entry: SpendEntry) -> None:
        entries.append(entry)
        await inner(entry)

    spend.record = _record
    return spend, entries


async def run_generation(*, user_id: str, generation_id: UUID) -> dict:
    """Drive one persisted generation to a terminal state.

    Runs in the worker (Modal), not the request. Every exit path writes a
    terminal row: success with outputs and cost, or failure with an
    explanatory message and whatever the attempt had already spent.
    """
    generation = await studio_repo.get(generation_id, user_id=user_id)
    if generation is None:
        return {"status": "failed", "error": "generation not found"}
    if not await studio_repo.claim_for_run(generation_id, user_id=user_id):
        # Already running or terminal — a duplicate spawn must never pay twice.
        return {"status": generation.status, "error": "generation already claimed"}

    spend, entries = await _recording_context(user_id, generation_id)

    def _spent() -> Decimal:
        return sum((e.cost_usd for e in entries), Decimal("0"))

    try:
        model = resolve_model(generation.kind, generation.model)
        _require_provider(model)
        params = validate_params(model, generation.params)
        await check_input_urls(params)
        await studio_repo.set_provider(
            generation_id, user_id=user_id, provider=model.provider
        )

        work_dir = work_dir_for(user_id, generation_id)
        work_dir.mkdir(parents=True, exist_ok=True)
        run = await _dispatch(model, params, work_dir=work_dir, spend=spend)
        if run.provider_request_id:
            await studio_repo.set_provider(
                generation_id,
                user_id=user_id,
                provider=model.provider,
                provider_request_id=run.provider_request_id,
            )
        outputs = await _store_outputs(
            user_id=user_id, generation_id=generation_id, model=model, files=run.files
        )
    except Exception as exc:  # noqa: BLE001 — a stuck row is worse than a message
        message = f"{type(exc).__name__}: {exc}"
        log.warning(
            "studio generation failed",
            extra={"generation_id": str(generation_id), "error": message},
        )
        await studio_repo.fail(
            generation_id, user_id=user_id, error=message, cost_usd=_spent()
        )
        return {"status": "failed", "error": message}

    await studio_repo.complete(
        generation_id, user_id=user_id, outputs=outputs, cost_usd=_spent()
    )
    return {"status": "done", "outputs": len(outputs), "cost_usd": str(_spent())}


async def create_generation(
    *, user_id: str, kind: str, model_id: str, params: dict
) -> StudioGeneration:
    """Validate, gate on spend, and persist a queued generation row."""
    clean = await preflight(
        user_id=user_id, kind=kind, model_id=model_id, params=params
    )
    return await studio_repo.create(
        user_id=user_id, kind=kind, model=model_id, params=clean
    )


def upload_key(user_id: str, filename: str) -> str:
    """Object key for a Studio reference upload. The random prefix keeps
    one user's uploads from colliding (and keeps a guessable filename from
    being a guessable key)."""
    safe = Path(filename).name.replace("/", "_").strip() or "upload"
    return f"users/{user_id}/studio/uploads/{uuid4().hex}/{safe}"
