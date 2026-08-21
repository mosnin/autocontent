"""Seedance 2.5 Preview video provider (ByteDance, served by the MuAPI gateway).

Ported from the standalone `seedance-2.5-mcp` server (server_core.py's
catalog + job protocol) into this product's pluggable video-model system.
What changed in the port, and why:

* **Metered.** The source spends the operator's MuAPI credits with no cap
  model at all. Here every render goes through `SpendContext`:
  `ensure_can_spend` refuses it against the niche cap / global daily cap /
  prepaid credit BEFORE submit, and `log` records the ledger row once the
  gateway has accepted (and therefore billed) the job.
* **Validated before spending.** The source validates a prompt and the
  image-list arity; everything else (aspect ratio, duration, resolution)
  is only a JSON-schema hint the MCP client may or may not enforce. Here
  the declared capabilities ARE the validator — unknown model, unsupported
  aspect ratio, out-of-range duration, unsupported resolution and unknown
  camera move all raise before a single provider call.
* **Fail-closed config.** No key => `SeedanceDisabled` naming the env var.
  Never a silent fallback to another provider, never an ImportError.
* **URLs are SSRF-checked.** Reference images/videos/audio are fetched by
  a third party on our behalf, so an unchecked URL turns submit into a
  confused-deputy request. Same guard the UGC studio uses.

Wire protocol (identical to `services/muapi.py`, same gateway):

  POST {base}/{endpoint}                      x-api-key: $key
    body: {"prompt": ..., "aspect_ratio": "9:16", "duration": 5,
           "image_url": "https://...", "images_list": [...], "seed": 42}
  -> 200 {"request_id": "..."}                 # some routes key it "id"

  GET  {base}/predictions/{request_id}/result
  -> 200 {"status": "completed"|"failed"|..., "outputs": ["https://...mp4"]}

Resolution is NOT a body field: the 480p tier is a *different allowlisted
endpoint* (`...-480p`), exactly as in the source. Sending `resolution` in
the body would be silently ignored by the gateway, so callers would think
they had bought a tier they hadn't.

Concurrency: `render()` gates itself with `provider_limits.slot("seedance")`
for the whole submit->poll->download span — the same span the pipeline
wraps around `fal_video.animate`. Call sites must therefore NOT wrap
seedance calls in another `slot("seedance")`: the gate is not reentrant and
a saturated gate would self-deadlock the task holding it.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal, Sequence

import httpx
from pydantic import BaseModel
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..logging import get_logger
from . import muapi, provider_limits
from .spend_context import SpendContext
from .ssrf import check_public_url

log = get_logger(__name__)

PROVIDER = "seedance"
HTTP_TIMEOUT_SEC = 60.0
POLL_INTERVAL_SEC = 4.0
# Longer than fal's 10 minutes: Seedance renders up to 30s of video and the
# gateway queues behind other tenants. A poll timeout is not a refund —
# the spend is already logged — so it only decides how long we wait before
# handing the job back as "still running".
POLL_TIMEOUT_SEC = 900.0

# The source's full ratio set, ported unchanged.
ASPECT_RATIOS: tuple[str, ...] = ("16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21")
RESOLUTIONS: tuple[str, ...] = ("720p", "480p")

# Seedance takes camera direction as prose inside the prompt — there is no
# dedicated API field for it. A closed token set gives agents and the UI a
# discoverable, validatable camera-control surface and keeps the phrasing
# consistent, instead of every caller inventing its own wording (which is
# what makes camera behaviour irreproducible between renders).
CAMERA_MOVES: dict[str, str] = {
    "static": "static locked-off camera",
    "pan_left": "camera pans smoothly to the left",
    "pan_right": "camera pans smoothly to the right",
    "tilt_up": "camera tilts up",
    "tilt_down": "camera tilts down",
    "zoom_in": "camera slowly zooms in",
    "zoom_out": "camera slowly zooms out",
    "dolly_in": "camera dollies in towards the subject",
    "dolly_out": "camera dollies away from the subject",
    "truck_left": "camera trucks left alongside the subject",
    "truck_right": "camera trucks right alongside the subject",
    "crane_up": "crane shot rising above the scene",
    "orbit_left": "camera orbits the subject to the left",
    "orbit_right": "camera orbits the subject to the right",
    "handheld": "handheld camera with natural shake",
    "fpv_drone": "fast FPV drone move through the scene",
}


class SeedanceError(RuntimeError):
    """The provider rejected the request or failed the render."""


class SeedanceDisabled(RuntimeError):
    """Seedance is unconfigured — fail closed, loudly, never a 500 and
    never a silent swap to another provider."""


class SeedanceValidationError(ValueError):
    """A parameter the selected Seedance route does not support.

    Raised before any provider call and before any spend, so callers can
    turn it into a 400 rather than paying for a render the gateway will
    reject."""


class SeedancePricingError(RuntimeError):
    """No pinned price for this model/resolution — refuse to render.

    Rendering at an unknown price would put an unmetered charge on the
    operator's gateway account, so this fails closed rather than
    defaulting to zero."""


class SeedanceModel(BaseModel):
    """One Seedance 2.5 route and everything the validator/UI needs.

    The same declaration drives capability validation, the MCP/HTTP model
    listing and the price lookup — a capability declared in only one of
    those places is a capability that isn't actually enforced.
    """

    id: str
    name: str
    tagline: str
    # 't2v' text-only; 'i2v' animates exactly one image; 'first_last'
    # interpolates between exactly two frames; 'omni' combines image,
    # video and audio references (this is the character-reference route).
    kind: Literal["t2v", "i2v", "first_last", "omni"]
    # 720p route; the 480p tier is a separate allowlisted endpoint.
    endpoint: str
    endpoint_480p: str

    aspect_ratios: tuple[str, ...] = ASPECT_RATIOS
    # Vertical by default, deliberately: the source defaults to 16:9
    # because it is a general-purpose video server, while this product's
    # video lane exists to make TikTok/Reels/Shorts. The *allowed* set is
    # ported unchanged, only the default differs — same call the UGC
    # catalog already made.
    default_aspect_ratio: str = "9:16"

    resolutions: tuple[str, ...] = RESOLUTIONS
    default_resolution: str = "720p"

    duration_min: int = 4
    duration_max: int = 30
    default_duration: int = 5

    # Reference-media arity for this route. min_images > 0 makes images
    # mandatory (i2v needs one, first/last needs two).
    min_images: int = 0
    max_images: int = 0
    max_videos: int = 0
    max_audios: int = 0
    # True where the route can hold a character's identity across shots
    # from reference images (the omni route's headline capability).
    supports_character_reference: bool = False

    camera_controls: tuple[str, ...] = tuple(CAMERA_MOVES)

    def allows_duration(self, seconds: int) -> bool:
        return self.duration_min <= seconds <= self.duration_max

    def endpoint_for(self, resolution: str) -> str:
        """The allowlisted gateway path for a tier. Never string-built from
        caller input: an arbitrary endpoint is exactly the hole the source
        avoids by allowlisting, and we keep that property."""
        if resolution == "480p":
            return self.endpoint_480p
        return self.endpoint


# The four standard Seedance 2.5 Preview routes, ported from the source's
# ROUTES / LOW_RES_ENDPOINTS maps.
SEEDANCE_MODELS: list[SeedanceModel] = [
    SeedanceModel(
        id="seedance-2.5-text-to-video",
        name="Seedance 2.5 (text to video)",
        tagline="Prompt-only clips, 4-30s, strong camera-direction adherence",
        kind="t2v",
        endpoint="seedance-2.5-text-to-video",
        endpoint_480p="seedance-2.5-text-to-video-480p",
    ),
    SeedanceModel(
        id="seedance-2.5-image-to-video",
        name="Seedance 2.5 (image to video)",
        tagline="Animate one keyframe while holding its subject and style",
        kind="i2v",
        endpoint="seedance-2.5-image-to-video",
        endpoint_480p="seedance-2.5-image-to-video-480p",
        min_images=1,
        max_images=1,
        supports_character_reference=True,
    ),
    SeedanceModel(
        id="seedance-2.5-first-last-frame",
        name="Seedance 2.5 (first/last frame)",
        tagline="Interpolate a transition between exactly two frames",
        kind="first_last",
        endpoint="seedance-2.5-first-last-frame",
        endpoint_480p="seedance-2.5-first-last-frame-480p",
        min_images=2,
        max_images=2,
    ),
    SeedanceModel(
        id="seedance-2.5-omni-reference",
        name="Seedance 2.5 (omni reference)",
        tagline="Character/style/motion references: up to 20 images, 6 clips, 6 audio",
        kind="omni",
        endpoint="seedance-2.5-omni-reference",
        endpoint_480p="seedance-2.5-omni-reference-480p",
        max_images=20,
        max_videos=6,
        max_audios=6,
        supports_character_reference=True,
    ),
]

_BY_ID = {m.id: m for m in SEEDANCE_MODELS}

# --------------------------------------------------------------------- pricing

# PINNED USD per rendered second, per model, per resolution tier.
#
# Why pinned (same discipline as services/fal_video.py and ugc/pricing.py):
# metering has to know what a render costs BEFORE it is submitted so
# `SpendContext.ensure_can_spend` can refuse it against the niche cap, the
# global daily cap and prepaid credit. Neither the submit response nor the
# completion document carries a price, so there is no runtime source of
# truth to read — a pinned table is the only way to gate spend at the
# moment it matters. An upstream price change must therefore be a
# DELIBERATE EDIT here (reviewable in the diff) so COGS stays priceable;
# `MARKETER_SEEDANCE_PRICE_OVERRIDES` exists for the emergency case where
# the vendor moves first and a deploy would be too slow.
#
# Rates: the gateway's published Seedance 2.5 Preview price at integration
# time is ~$0.10 per rendered second at 720p — the same rate this repo
# already pins for the comparable multi-shot models (Sora 2 / Veo 3 Fast in
# fal_video, `seedance-2` in ugc/pricing). The 480p routes are the
# explicit cheap-preview tier; they are pinned at half, mirroring the 1:2
# 480p:720p step already pinned for grok-video in ugc/pricing.py.
USD_PER_SECOND: dict[str, dict[str, Decimal]] = {
    "seedance-2.5-text-to-video": {"720p": Decimal("0.10"), "480p": Decimal("0.05")},
    "seedance-2.5-image-to-video": {"720p": Decimal("0.10"), "480p": Decimal("0.05")},
    "seedance-2.5-first-last-frame": {"720p": Decimal("0.10"), "480p": Decimal("0.05")},
    # The omni route conditions on up to 32 reference assets and costs the
    # gateway more to serve; priced a tier above the plain routes.
    "seedance-2.5-omni-reference": {"720p": Decimal("0.15"), "480p": Decimal("0.075")},
}

_QUANTUM = Decimal("0.0001")


def _setting(name: str, default: Any) -> Any:
    """Read a `seedance_*` setting that may not exist on Settings yet.

    `config.py` is owned by the lead and the `seedance_*` fields land in a
    separate commit; until then this resolves to the documented default so
    importing this module can never explode. Once the fields exist, getattr
    finds them and the defaults become dead code.
    """
    return getattr(settings, name, default)


def api_key() -> str:
    """The gateway credential.

    Falls back to `MARKETER_MUAPI_API_KEY` because Seedance is served by
    the same MuAPI gateway account as the UGC studio — one vendor, one
    credential. This is a credential lookup, NOT a provider fallback: with
    neither key set the feature is unavailable and says so.
    """
    return str(_setting("seedance_api_key", "") or settings.muapi_api_key or "")


def base_url() -> str:
    return str(_setting("seedance_base_url", "") or settings.muapi_base_url).rstrip("/")


def enabled() -> bool:
    return bool(api_key())


def require_enabled() -> None:
    if not enabled():
        raise SeedanceDisabled(
            "the Seedance video provider is unconfigured "
            "(set MARKETER_SEEDANCE_API_KEY, or MARKETER_MUAPI_API_KEY for the "
            "shared gateway account)"
        )


def get_model(model_id: str) -> SeedanceModel | None:
    return _BY_ID.get(model_id)


def list_models() -> list[SeedanceModel]:
    return list(SEEDANCE_MODELS)


def require_model(model_id: str) -> SeedanceModel:
    model = get_model(model_id)
    if model is None:
        known = ", ".join(sorted(_BY_ID))
        raise SeedanceValidationError(f"unknown seedance model {model_id!r} (known: {known})")
    return model


def _price_overrides() -> dict[str, Decimal]:
    """Operator-supplied unit-price corrections, parsed per call.

    `MARKETER_SEEDANCE_PRICE_OVERRIDES='{"seedance-2.5-omni-reference@720p": "0.18"}'`
    fixes registry drift against the gateway's published prices without a
    deploy. Keys are either `model_id` (every tier of that model) or
    `model_id@resolution` (one tier, and it wins over the bare form).
    Malformed JSON or values are ignored — never break a render over a
    pricing knob — but logged loudly, because a silently dropped override
    means metering and caps quietly run on stale prices, which is exactly
    what an operator needs to notice. Mirrors `fal_video._price_overrides`.
    """
    raw = _setting("seedance_price_overrides", "")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning(
            "seedance price overrides: MARKETER_SEEDANCE_PRICE_OVERRIDES is not "
            "valid JSON, ignoring",
            extra={"error": str(exc)},
        )
        return {}
    if not isinstance(parsed, dict):
        log.warning(
            "seedance price overrides: expected a JSON object, got %s, ignoring",
            type(parsed).__name__,
        )
        return {}
    out: dict[str, Decimal] = {}
    for key, val in parsed.items():
        try:
            price = Decimal(str(val))
        except (InvalidOperation, ValueError):
            log.warning("seedance price overrides: dropping unparseable price for %r: %r", key, val)
            continue
        if price > 0:
            out[str(key)] = price
        else:
            log.warning("seedance price overrides: dropping non-positive price for %r: %r", key, val)
    return out


def usd_per_second(model: SeedanceModel, resolution: str) -> Decimal:
    overrides = _price_overrides()
    for key in (f"{model.id}@{resolution}", model.id):
        if key in overrides:
            return overrides[key]
    table = USD_PER_SECOND.get(model.id) or {}
    price = table.get(resolution)
    if price is None:
        raise SeedancePricingError(
            f"no pinned price for {model.id!r} at resolution {resolution!r}"
        )
    return price


def render_cost(model: SeedanceModel, *, duration: float, resolution: str) -> Decimal:
    return (usd_per_second(model, resolution) * Decimal(str(duration))).quantize(_QUANTUM)


def cost_basis(model: SeedanceModel) -> dict[str, Any]:
    """The per-second rate card for one model, for the UI/MCP listing.

    Override-applied, so the estimate a caller is shown is the number
    metering will actually charge.
    """
    prices: dict[str, str] = {}
    for res in model.resolutions:
        try:
            prices[res] = str(usd_per_second(model, res))
        except SeedancePricingError:
            prices[res] = ""
    return {"unit": "usd_per_second", "by_resolution": prices}


def describe(model: SeedanceModel) -> dict[str, Any]:
    """One catalog entry, shaped for an agent or an adaptive UI."""
    return {
        "id": model.id,
        "name": model.name,
        "tagline": model.tagline,
        "provider": PROVIDER,
        "kind": model.kind,
        "aspect_ratios": list(model.aspect_ratios),
        "default_aspect_ratio": model.default_aspect_ratio,
        "resolutions": list(model.resolutions),
        "default_resolution": model.default_resolution,
        "duration": {
            "kind": "range",
            "min": model.duration_min,
            "max": model.duration_max,
            "default": model.default_duration,
        },
        "camera_controls": list(model.camera_controls),
        "reference_media": {
            "min_images": model.min_images,
            "max_images": model.max_images,
            "max_videos": model.max_videos,
            "max_audios": model.max_audios,
            "character_reference": model.supports_character_reference,
        },
        "cost_basis": cost_basis(model),
        "available": enabled(),
    }


def catalog() -> list[dict[str, Any]]:
    return [describe(m) for m in SEEDANCE_MODELS]


# ------------------------------------------------------------------ validation


def compose_prompt(prompt: str, camera_move: str | None) -> str:
    """Fold a validated camera token into the prompt text."""
    if not camera_move:
        return prompt
    phrase = CAMERA_MOVES[camera_move]
    return f"{prompt.rstrip().rstrip('.')}. {phrase}."


def _check_list(
    urls: Sequence[str], *, key: str, minimum: int, maximum: int
) -> list[str]:
    values = [u.strip() for u in urls if isinstance(u, str) and u.strip()]
    if len(values) < minimum or len(values) > maximum:
        raise SeedanceValidationError(
            f"{key} must contain between {minimum} and {maximum} url(s), got {len(values)}"
        )
    return values


@dataclass(frozen=True)
class SeedanceRequest:
    """A validated, priced render — everything needed to submit and meter it."""

    model: SeedanceModel
    endpoint: str
    resolution: str
    prompt: str
    aspect_ratio: str
    duration: int
    image_urls: tuple[str, ...] = ()
    video_urls: tuple[str, ...] = ()
    audio_urls: tuple[str, ...] = ()
    seed: int | None = None

    def body(self) -> dict[str, Any]:
        """The wire payload.

        `resolution` is deliberately absent: the tier is encoded in the
        endpoint (see module docstring). Both `image_url` and `images_list`
        are sent for the same reason `services/muapi.py` does it — routes
        behind the gateway read different fields.
        """
        payload: dict[str, Any] = {
            "prompt": self.prompt,
            "aspect_ratio": self.aspect_ratio,
            "duration": self.duration,
        }
        if self.image_urls:
            payload["image_url"] = self.image_urls[0]
            payload["images_list"] = list(self.image_urls)
        if self.video_urls:
            payload["videos_list"] = list(self.video_urls)
        if self.audio_urls:
            payload["audios_list"] = list(self.audio_urls)
        if self.seed is not None:
            payload["seed"] = self.seed
        return payload

    def cost_usd(self) -> Decimal:
        return render_cost(self.model, duration=self.duration, resolution=self.resolution)

    def reference_urls(self) -> list[str]:
        return [*self.image_urls, *self.video_urls, *self.audio_urls]


def build_request(
    model_id: str,
    *,
    prompt: str,
    image_urls: Sequence[str] = (),
    video_urls: Sequence[str] = (),
    audio_urls: Sequence[str] = (),
    aspect_ratio: str | None = None,
    duration: int | None = None,
    resolution: str | None = None,
    camera_move: str | None = None,
    seed: int | None = None,
) -> SeedanceRequest:
    """Validate every caller-supplied parameter against the model's declared
    capabilities and resolve defaults. Raises `SeedanceValidationError`
    before any network call or spend."""
    model = require_model(model_id)

    text = (prompt or "").strip()
    if not text:
        raise SeedanceValidationError("prompt is required")

    ar = (aspect_ratio or "").strip() or model.default_aspect_ratio
    if ar not in model.aspect_ratios:
        raise SeedanceValidationError(
            f"{model.id} does not support aspect ratio {ar!r} "
            f"(supported: {', '.join(model.aspect_ratios)})"
        )

    dur = model.default_duration if duration is None else int(duration)
    if not model.allows_duration(dur):
        raise SeedanceValidationError(
            f"{model.id} does not support a {dur}s duration "
            f"(allowed: {model.duration_min}-{model.duration_max}s)"
        )

    res = (resolution or "").strip() or model.default_resolution
    if res not in model.resolutions:
        raise SeedanceValidationError(
            f"{model.id} does not support resolution {res!r} "
            f"(supported: {', '.join(model.resolutions)})"
        )

    move = (camera_move or "").strip()
    if move and move not in model.camera_controls:
        raise SeedanceValidationError(
            f"unknown camera move {move!r} (supported: {', '.join(model.camera_controls)})"
        )

    images = _check_list(
        image_urls, key="image_urls", minimum=model.min_images, maximum=model.max_images
    )
    videos = _check_list(video_urls, key="video_urls", minimum=0, maximum=model.max_videos)
    audios = _check_list(audio_urls, key="audio_urls", minimum=0, maximum=model.max_audios)

    return SeedanceRequest(
        model=model,
        endpoint=model.endpoint_for(res),
        resolution=res,
        prompt=compose_prompt(text, move or None),
        aspect_ratio=ar,
        duration=dur,
        image_urls=tuple(images),
        video_urls=tuple(videos),
        audio_urls=tuple(audios),
        seed=seed,
    )


async def check_reference_urls(urls: Sequence[str]) -> None:
    """SSRF-check every URL the gateway will fetch on our behalf.

    `check_public_url` does DNS, so it runs off-loop. Same guard the UGC
    studio applies to reference images — an unchecked URL here is a
    confused-deputy request against internal infrastructure.
    """
    for url in urls:
        ok, reason = await asyncio.to_thread(check_public_url, url)
        if not ok:
            raise SeedanceValidationError(f"reference url rejected ({reason}): {url}")


# ----------------------------------------------------------------- http client


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url(),
        timeout=HTTP_TIMEOUT_SEC,
        headers={"x-api-key": api_key(), "Content-Type": "application/json"},
    )


def _is_retryable(exc: BaseException) -> bool:
    """Retry rate limits, 5xx and transport faults only. Deterministic 4xx
    (bad params, no gateway credit, bad key) fail identically on retry.
    Mirrors `muapi._is_retryable` / `fal_video._is_retryable`."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.HTTPError)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _post(client: httpx.AsyncClient, endpoint: str, body: dict[str, Any]) -> dict:
    # NOTE: this enqueues a *paid* render. Retries only fire for transport
    # faults and 429/5xx — never for a request the gateway actually
    # rejected — but a lost response on a request that did land would
    # re-submit and pay twice. The gateway exposes no client idempotency
    # key, so the residual risk is the one already accepted in
    # fal_video._submit and muapi._post, for the same reason: never
    # retrying would fail every render that hits a blip.
    resp = await client.post(f"/{endpoint.lstrip('/')}", json=body)
    resp.raise_for_status()
    return resp.json()


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _get(client: httpx.AsyncClient, path: str) -> dict:
    resp = await client.get(path)
    resp.raise_for_status()
    return resp.json()


async def submit(req: SeedanceRequest) -> str:
    """Enqueue a validated render; return the gateway's request id."""
    from ..billing.gates import raise_if_unbilled

    raise_if_unbilled()
    require_enabled()
    async with _client() as client:
        data = await _post(client, req.endpoint, req.body())
    request_id = data.get("request_id") or data.get("id")
    if not request_id:
        raise SeedanceError(f"submit response carried no request id: {data!r}")
    log.info("seedance.submitted", extra={"provider": PROVIDER, "sku": req.model.id})
    return str(request_id)


async def fetch_result(request_id: str) -> dict:
    """Poll one prediction document."""
    require_enabled()
    async with _client() as client:
        return await _get(client, f"/predictions/{request_id}/result")


# The gateway's result document is the same shape `services/muapi.py`
# already normalizes (same vendor, same protocol), so we reuse its parser
# rather than growing a second, subtly different job protocol.
parse_result = muapi.parse_result
STATUS_DONE = muapi.STATUS_DONE
STATUS_FAILED = muapi.STATUS_FAILED
STATUS_RUNNING = muapi.STATUS_RUNNING


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


@dataclass(frozen=True)
class SeedanceRender:
    """The outcome of one metered render."""

    request_id: str
    model_id: str
    status: str
    resolution: str
    duration_sec: int
    cost_usd: Decimal
    video_url: str = ""
    path: Path | None = None


async def _await_result(client: httpx.AsyncClient, request_id: str) -> tuple[str, str, str]:
    deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT_SEC
    while True:
        payload = await _get(client, f"/predictions/{request_id}/result")
        status, video_url, error = parse_result(payload)
        if status != STATUS_RUNNING:
            return status, video_url, error
        if asyncio.get_event_loop().time() >= deadline:
            return STATUS_RUNNING, "", f"still running after {POLL_TIMEOUT_SEC}s"
        await asyncio.sleep(POLL_INTERVAL_SEC)


async def render(
    *,
    model_id: str,
    prompt: str,
    out_path: Path | None = None,
    image_urls: Sequence[str] = (),
    video_urls: Sequence[str] = (),
    audio_urls: Sequence[str] = (),
    aspect_ratio: str | None = None,
    duration: int | None = None,
    resolution: str | None = None,
    camera_move: str | None = None,
    seed: int | None = None,
    spend: SpendContext | None = None,
    wait: bool = True,
) -> SeedanceRender:
    """Validate, meter, submit, and (by default) wait for one Seedance render.

    Order of operations is the whole point:
      1. fail closed if unconfigured;
      2. validate every parameter against declared capabilities;
      3. SSRF-check the URLs the gateway will fetch;
      4. price it from the PINNED registry and `ensure_can_spend` — the
         niche cap, global daily cap and prepaid credit all get to refuse
         BEFORE a paid call happens;
      5. submit, then `log` the ledger row (the gateway bills on accept,
         so that is the moment the money is real);
      6. poll, and download to `out_path` when one is given.

    With `wait=False` the call returns as soon as the job is accepted and
    metered — for the async/webhook style the UGC studio uses.
    """
    from ..billing.gates import raise_if_unbilled

    raise_if_unbilled()
    require_enabled()
    req = build_request(
        model_id,
        prompt=prompt,
        image_urls=image_urls,
        video_urls=video_urls,
        audio_urls=audio_urls,
        aspect_ratio=aspect_ratio,
        duration=duration,
        resolution=resolution,
        camera_move=camera_move,
        seed=seed,
    )
    await check_reference_urls(req.reference_urls())

    cost = req.cost_usd()
    if spend is not None:
        # Pre-flight refusal happens outside the concurrency gate: there is
        # no reason to hold a provider permit while a cap check runs.
        await spend.ensure_can_spend(cost)

    # One gate for the whole submit->poll->download span, matching how the
    # pipeline wraps fal_video.animate. Do NOT wrap this call in another
    # slot("seedance") — see the module docstring.
    async with provider_limits.slot(PROVIDER):
        async with _client() as client:
            data = await _post(client, req.endpoint, req.body())
            request_id = str(data.get("request_id") or data.get("id") or "")
            if not request_id:
                raise SeedanceError(f"submit response carried no request id: {data!r}")

            if spend is not None:
                await _log_spend(spend, req, cost)

            if not wait:
                return SeedanceRender(
                    request_id=request_id,
                    model_id=req.model.id,
                    status=STATUS_RUNNING,
                    resolution=req.resolution,
                    duration_sec=req.duration,
                    cost_usd=cost,
                )

            status, video_url, error = await _await_result(client, request_id)
            if status == STATUS_FAILED:
                raise SeedanceError(f"seedance render failed: {error or 'unknown error'}")
            if status == STATUS_RUNNING:
                # Timed out waiting. The spend is real and already logged,
                # so hand the job back rather than pretending it failed —
                # the caller can poll `fetch_result` later.
                return SeedanceRender(
                    request_id=request_id,
                    model_id=req.model.id,
                    status=STATUS_RUNNING,
                    resolution=req.resolution,
                    duration_sec=req.duration,
                    cost_usd=cost,
                )

            path: Path | None = None
            if out_path is not None:
                await _download(client, video_url, out_path)
                path = out_path

    return SeedanceRender(
        request_id=request_id,
        model_id=req.model.id,
        status=STATUS_DONE,
        resolution=req.resolution,
        duration_sec=req.duration,
        cost_usd=cost,
        video_url=video_url,
        path=path,
    )


async def _log_spend(spend: SpendContext, req: SeedanceRequest, cost: Decimal) -> None:
    """Record the ledger row for an accepted render.

    A post-log cap/credit trip is logged and swallowed, exactly as
    `ugc/render._dispatch` does: the debit landed and the gateway is
    already rendering, so surfacing it as a failed submit would be a lie.
    `SpendContext` has still flipped `abort_event`, so sibling tasks and
    later stages short-circuit on their own pre-flight checks.
    """
    try:
        await spend.log(
            provider=PROVIDER,
            sku=req.model.id,
            units=Decimal(str(req.duration)),
            cost_usd=cost,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "seedance.spend_log_tripped_cap",
            extra={"provider": PROVIDER, "sku": req.model.id, "error": str(exc)},
        )


async def text_to_video(
    prompt: str,
    out_path: Path | None = None,
    **kwargs: Any,
) -> SeedanceRender:
    """Text-to-video convenience wrapper over `render`."""
    kwargs.setdefault("model_id", "seedance-2.5-text-to-video")
    return await render(prompt=prompt, out_path=out_path, **kwargs)


async def image_to_video(
    image_url: str,
    prompt: str,
    out_path: Path | None = None,
    **kwargs: Any,
) -> SeedanceRender:
    """Image-to-video convenience wrapper over `render`.

    Takes a public URL rather than a local path (unlike `fal_video.animate`,
    which base64s the keyframe inline): this gateway fetches references by
    URL, so a local keyframe must be published to object storage first.
    """
    kwargs.setdefault("model_id", "seedance-2.5-image-to-video")
    return await render(prompt=prompt, out_path=out_path, image_urls=[image_url], **kwargs)
