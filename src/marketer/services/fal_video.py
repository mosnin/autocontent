"""Fal-hosted image-to-video models (queue API).

Alternative animation backend to Grok Imagine: the niche picks
`video_provider='fal'` plus one of the curated models below, and every
scene clip renders through Fal instead. Config-gated on
`MARKETER_FAL_API_KEY` — without it the pipeline refuses cleanly at
submit time (jobs fail with a clear error, never a KeyError).

Queue flow (docs.fal.ai):

  POST https://queue.fal.run/{model}
    Authorization: Key $FAL_KEY
    body: { "prompt": ..., "image_url": "data:image/png;base64,...",
            "duration": "5", ... }
  -> 200 { "request_id", "status_url", "response_url" }

  GET {status_url}  -> { "status": "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED" }
  GET {response_url} -> { "video": { "url": "https://...mp4" } }

Pricing is a curated registry (per second of rendered video, matching
Fal's published unit prices at integration time). Every render logs a
spend_ledger row with provider="fal" and the model id as the SKU, so
per-model costs are visible in cost-by-job and billing exactly like
Grok/OpenAI spend.
"""
from __future__ import annotations

import asyncio
import base64
import json
import subprocess
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..config import settings
from ..logging import get_logger
from .spend_context import SpendContext

log = get_logger(__name__)

PROVIDER = "fal"
QUEUE_BASE = "https://queue.fal.run"
POLL_INTERVAL_SEC = 4.0
POLL_TIMEOUT_SEC = 600.0
HTTP_TIMEOUT_SEC = 60.0

# fal's queue endpoint (and the underlying providers behind it) reject
# oversized JSON bodies with an opaque 413/400 well after we've already
# paid for keyframe/voiceover generation. Fail fast, locally, with a
# message that names the actual problem instead of surfacing a provider
# 413 up through animate()/animate_avatar().
MAX_DATA_URI_BYTES = 10_000_000


class FalVideoModel(BaseModel):
    id: str            # fal model path, e.g. "fal-ai/kling-video/v2.1/standard/image-to-video"
    name: str          # display name for the UI dropdown
    tagline: str
    usd_per_second: Decimal
    max_duration_sec: int = 10
    # Durations the endpoint actually accepts (enum on most fal models);
    # requests snap to the nearest allowed value.
    allowed_durations: tuple[int, ...] = (5, 10)
    # Extra request fields some models require.
    extra_body: dict[str, Any] = {}
    # 'i2v' animates a keyframe from a motion prompt; 'avatar' is
    # audio-driven (image + voiceover in, lip-synced talking video out).
    kind: Literal["i2v", "avatar"] = "i2v"
    # Some endpoints (Veo 3, Luma Ray 2) declare `duration` as a string
    # enum WITH a unit suffix ("8s", "5s") rather than a bare integer
    # string ("8"). Bare integers 422 on those endpoints. Empty string
    # (the default) reproduces today's bare-integer behaviour.
    duration_suffix: str = ""
    # Some endpoints (Sora 2) validate the *input* reference image
    # against a fixed set of supported resolutions and reject anything
    # else — even though our keyframes are generated at a different
    # (correct-aspect-ratio) size. When set, animate() letterboxes the
    # keyframe to this exact (width, height) before upload.
    input_size: tuple[int, int] | None = None
    # For avatar (audio-driven) models this is the hard cap on *input*
    # audio length the provider accepts, not an output duration enum —
    # there is no duration knob for audio-driven renders. Exceeding it
    # is rejected by fal/the provider anyway; we check first so we fail
    # before spending on keyframe/voiceover generation.


def snap_duration(model: "FalVideoModel", requested_sec: float) -> int:
    return min(model.allowed_durations, key=lambda d: abs(d - requested_sec))


def format_duration(model: "FalVideoModel", duration_sec: int) -> str:
    """Render a snapped duration the way this model's endpoint expects
    it on the wire: bare ("5") for most models, suffixed ("8s") for the
    handful (Veo 3, Luma Ray 2) whose schema enum includes the unit."""
    return f"{duration_sec}{model.duration_suffix}"


# Curated image-to-video models. Prices are per rendered second.
FAL_VIDEO_MODELS: list[FalVideoModel] = [
    FalVideoModel(
        id="fal-ai/kling-video/v2.1/standard/image-to-video",
        name="Kling 2.1 Standard",
        tagline="Great motion coherence, strong price/quality",
        usd_per_second=Decimal("0.05"),
        allowed_durations=(5, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/kling-video/v2.1/pro/image-to-video",
        name="Kling 2.1 Pro",
        tagline="Sharper detail and camera control",
        usd_per_second=Decimal("0.09"),
        allowed_durations=(5, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/minimax/hailuo-02/standard/image-to-video",
        name="Hailuo 02 Standard",
        tagline="Expressive character/subject motion",
        usd_per_second=Decimal("0.045"),
        allowed_durations=(6, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/luma-dream-machine/ray-2",
        name="Luma Ray 2",
        tagline="Cinematic physics and lighting",
        usd_per_second=Decimal("0.18"),
        allowed_durations=(5, 9),
        max_duration_sec=9,
        # Ray 2's duration enum is "5s"/"9s", not bare "5"/"9".
        duration_suffix="s",
    ),
    FalVideoModel(
        id="fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
        name="Kling 2.5 Turbo Pro",
        tagline="Kling's latest — faster, sharper, stronger prompt adherence",
        usd_per_second=Decimal("0.07"),
        allowed_durations=(5, 10),
        max_duration_sec=10,
    ),
    FalVideoModel(
        id="fal-ai/veo3/fast/image-to-video",
        name="Google Veo 3 Fast",
        tagline="Veo 3 quality at speed — best realism per dollar",
        usd_per_second=Decimal("0.10"),
        allowed_durations=(8,),
        max_duration_sec=8,
        extra_body={"generate_audio": False},
        # Veo 3's duration enum is "8s", not bare "8".
        duration_suffix="s",
    ),
    FalVideoModel(
        id="fal-ai/veo3/image-to-video",
        name="Google Veo 3",
        tagline="State-of-the-art realism, physics, and cinematography",
        usd_per_second=Decimal("0.40"),
        allowed_durations=(8,),
        max_duration_sec=8,
        extra_body={"generate_audio": False},
        duration_suffix="s",
    ),
    FalVideoModel(
        id="fal-ai/sora-2/image-to-video",
        name="OpenAI Sora 2",
        tagline="Long coherent shots with strong scene understanding",
        usd_per_second=Decimal("0.10"),
        allowed_durations=(4, 8, 12),
        max_duration_sec=12,
        # Sora 2's image-to-video endpoint validates the reference image
        # against a fixed set of portrait resolutions; our keyframes are
        # generated at 1024x1536 (openai_images.SIZE_9_16), which Sora 2
        # rejects. Letterbox to its supported 720x1280 before upload.
        input_size=(720, 1280),
    ),
    FalVideoModel(
        id="fal-ai/pixverse/v5/image-to-video",
        name="Pixverse V5",
        tagline="Punchy stylized motion — great for animated looks",
        usd_per_second=Decimal("0.06"),
        allowed_durations=(5, 8),
        max_duration_sec=8,
    ),
    FalVideoModel(
        id="fal-ai/bytedance/omnihuman",
        name="OmniHuman (UGC avatar)",
        tagline="Lip-synced spokesperson from a single portrait — UGC mode",
        usd_per_second=Decimal("0.16"),
        # Avatar models have no output-duration enum (render length is
        # set by the input audio), so `allowed_durations` is unused here.
        # `max_duration_sec` instead caps the *input* voiceover length —
        # OmniHuman rejects audio beyond ~30s — and animate_avatar()
        # enforces it before submitting a paid render.
        allowed_durations=(5, 10, 15),
        max_duration_sec=30,
        kind="avatar",
    ),
    FalVideoModel(
        id="fal-ai/wan/v2.2-a14b/image-to-video",
        name="Wan 2.2 (14B)",
        tagline="Budget open-weights option",
        usd_per_second=Decimal("0.04"),
        allowed_durations=(5, 8),
        max_duration_sec=8,
    ),
]

_BY_ID = {m.id: m for m in FAL_VIDEO_MODELS}


class FalVideoError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(settings.fal_api_key)


def _price_overrides() -> dict[str, Decimal]:
    """Operator-supplied unit-price corrections, parsed per call.

    `MARKETER_FAL_PRICE_OVERRIDES='{"fal-ai/veo3/image-to-video": "0.45"}'`
    fixes registry drift against fal's published prices without a deploy
    of new code. Malformed JSON or values are ignored (never break
    rendering over a pricing knob) but are logged loudly — a silently
    dropped override means metering/caps quietly run on stale prices,
    which is exactly the kind of thing an operator needs to notice."""
    raw = settings.fal_price_overrides
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning(
            "fal price overrides: MARKETER_FAL_PRICE_OVERRIDES is not valid JSON, ignoring",
            extra={"error": str(exc)},
        )
        return {}
    if not isinstance(parsed, dict):
        log.warning(
            "fal price overrides: expected a JSON object, got %s, ignoring",
            type(parsed).__name__,
        )
        return {}
    out: dict[str, Decimal] = {}
    for key, val in parsed.items():
        try:
            price = Decimal(str(val))
        except (InvalidOperation, ValueError):
            log.warning(
                "fal price overrides: dropping unparseable price for %r: %r", key, val,
            )
            continue
        if price > 0:
            out[str(key)] = price
        else:
            log.warning(
                "fal price overrides: dropping non-positive price for %r: %r", key, val,
            )
    return out


def get_model(model_id: str) -> FalVideoModel | None:
    model = _BY_ID.get(model_id)
    if model is None:
        return None
    override = _price_overrides().get(model_id)
    if override is not None and override != model.usd_per_second:
        return model.model_copy(update={"usd_per_second": override})
    return model


def list_models() -> list[FalVideoModel]:
    """The registry with price overrides applied — what the UI and
    metering should see."""
    return [get_model(m.id) or m for m in FAL_VIDEO_MODELS]


def video_cost(model: FalVideoModel, seconds: float) -> Decimal:
    return (model.usd_per_second * Decimal(str(seconds))).quantize(Decimal("0.0001"))


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SEC,
        headers={"Authorization": f"Key {settings.fal_api_key}"},
    )


def _check_data_uri_size(uri: str, *, kind: str) -> None:
    if len(uri) > MAX_DATA_URI_BYTES:
        raise FalVideoError(
            f"{kind} is {len(uri)} bytes base64-encoded, over the "
            f"{MAX_DATA_URI_BYTES}-byte limit fal's queue endpoint accepts — "
            "refusing to submit rather than let the provider 413 mid-render"
        )


def _image_to_data_uri(path: Path) -> str:
    suffix = path.suffix.lstrip(".").lower() or "png"
    mime = {"jpg": "jpeg"}.get(suffix, suffix)
    uri = f"data:image/{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    _check_data_uri_size(uri, kind="keyframe image")
    return uri


def _audio_to_data_uri(path: Path) -> str:
    suffix = path.suffix.lstrip(".").lower() or "wav"
    mime = {"wav": "wav", "mp3": "mpeg", "m4a": "mp4"}.get(suffix, suffix)
    uri = f"data:audio/{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"
    _check_data_uri_size(uri, kind="voiceover audio")
    return uri


def _wav_duration_seconds(path: Path) -> float:
    import wave

    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
        return frames / float(rate) if rate else 0.0


def _run_ffmpeg(cmd: list[str]) -> None:
    """Thin seam over subprocess so tests can assert argv without
    spawning a real ffmpeg process."""
    subprocess.run(cmd, check=True, capture_output=True)


def _resize_keyframe(image_path: Path, size: tuple[int, int]) -> Path:
    """Letterbox `image_path` to an exact (width, height), centered, black
    bars — for endpoints (Sora 2) that validate the *input* reference
    image against a fixed set of supported resolutions. Returns a new
    temp file next to the source; caller is responsible for cleanup."""
    width, height = size
    tmp_path = image_path.with_name(
        f"{image_path.stem}.fal_resized_{width}x{height}{image_path.suffix or '.png'}"
    )
    _run_ffmpeg([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(image_path),
        "-vf",
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
        "-frames:v", "1",
        str(tmp_path),
    ])
    return tmp_path


def _is_retryable(exc: BaseException) -> bool:
    """Retry only on transient failures — rate limits, 5xx, and transport
    errors (connect/read timeouts, dropped connections). Deterministic
    4xx (400 bad request, 402 payment, 403 auth, 422 unprocessable) will
    fail identically on retry, so retrying them just burns time and, for
    _submit in particular, would never actually double-charge (fal
    rejects the request before it's queued) — but it's still pointless
    work. Mirrors elevenlabs_tts._is_retryable."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.HTTPError)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _submit(client: httpx.AsyncClient, model_id: str, body: dict) -> dict:
    # NOTE on double-submit risk: _submit enqueues a *paid* render. A
    # retry here only ever fires for transport errors (timeout/connection
    # drop) or 429/5xx — never for a request fal actually rejected — but
    # a transport error can still mean "the POST landed and was queued,
    # only the response was lost," in which case this retry re-submits
    # and pays twice. fal's queue API has no client-supplied idempotency
    # key, so this residual risk can't be closed from here; it's judged
    # acceptable because it requires both a network fault AND
    # server-side success on the very request that faulted, whereas
    # never retrying transport errors would fail every render that hits
    # a blip. Reraise-on-exhaustion still surfaces the failure to the
    # caller rather than silently swallowing spend.
    resp = await client.post(f"{QUEUE_BASE}/{model_id}", json=body)
    resp.raise_for_status()
    out = resp.json()
    if not out.get("status_url") or not out.get("response_url"):
        raise FalVideoError(f"queue response missing urls: {out!r}")
    return out


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=16),
    retry=retry_if_exception(_is_retryable),
)
async def _poll_once(client: httpx.AsyncClient, status_url: str) -> dict:
    resp = await client.get(status_url)
    resp.raise_for_status()
    return resp.json()


async def _await_completion(client: httpx.AsyncClient, status_url: str) -> None:
    deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT_SEC
    while True:
        body = await _poll_once(client, status_url)
        status = body.get("status")
        if status == "COMPLETED":
            return
        if status in ("FAILED", "CANCELLED", "ERROR"):
            raise FalVideoError(f"fal request {status}: {body!r}")
        if asyncio.get_event_loop().time() >= deadline:
            raise FalVideoError(f"fal request timed out after {POLL_TIMEOUT_SEC}s")
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


async def animate(
    keyframe_path: Path,
    motion_prompt: str,
    out_path: Path,
    *,
    model_id: str,
    duration_sec: float = 5.0,
    spend: SpendContext | None = None,
) -> Path:
    """Render one scene clip through a Fal image-to-video model."""
    if not enabled():
        raise FalVideoError(
            "fal video provider selected but MARKETER_FAL_API_KEY is not set"
        )
    model = get_model(model_id)
    if model is None:
        raise FalVideoError(f"unknown fal model {model_id!r}")

    # Snap to the model's accepted duration enum — arbitrary integers 400
    # on most fal endpoints, killing the job after the keyframe was paid for.
    duration = snap_duration(model, duration_sec)
    if spend is not None:
        await spend.ensure_can_spend(video_cost(model, duration))

    # Some endpoints (Sora 2) enforce a fixed input-image resolution;
    # letterbox to it before upload rather than let the provider 422 on
    # a keyframe we already paid to generate.
    upload_path = keyframe_path
    resized_path: Path | None = None
    if model.input_size is not None:
        resized_path = _resize_keyframe(keyframe_path, model.input_size)
        upload_path = resized_path

    try:
        body = {
            "prompt": motion_prompt,
            "image_url": _image_to_data_uri(upload_path),
            # Duration enum format is per-model: bare "8" on most
            # endpoints, but Veo 3 / Luma Ray 2 require the unit suffix
            # ("8s"). See FalVideoModel.duration_suffix.
            "duration": format_duration(model, duration),
            **model.extra_body,
        }

        async with _client() as client:
            queued = await _submit(client, model.id, body)
            await _await_completion(client, queued["status_url"])
            resp = await client.get(queued["response_url"])
            resp.raise_for_status()
            result = resp.json()
            video = result.get("video") or {}
            video_url = video.get("url")
            if not video_url:
                raise FalVideoError(f"completed but no video.url: {result!r}")
            await _download(client, video_url, out_path)
    finally:
        if resized_path is not None and resized_path.exists():
            resized_path.unlink(missing_ok=True)

    if spend is not None:
        # Bill the seconds fal actually rendered when reported (some
        # models return slightly different durations than requested).
        billed = float(video.get("duration") or duration)
        cost = video_cost(model, billed)
        await spend.log(
            provider=PROVIDER,
            sku=model.id,
            units=Decimal(str(billed)),
            cost_usd=cost,
        )
    return out_path


async def animate_avatar(
    keyframe_path: Path,
    audio_path: Path,
    out_path: Path,
    *,
    model_id: str,
    spend: SpendContext | None = None,
) -> Path:
    """Render a lip-synced talking clip: portrait keyframe + voiceover in,
    a video of that person speaking the audio out.

    Audio-driven models set their own output length from the voiceover, so
    there is no duration knob — the pre-flight estimate and the billed
    units both come from the audio (or the provider-reported render
    duration when present)."""
    if not enabled():
        raise FalVideoError(
            "fal video provider selected but MARKETER_FAL_API_KEY is not set"
        )
    model = get_model(model_id)
    if model is None:
        raise FalVideoError(f"unknown fal model {model_id!r}")
    if model.kind != "avatar":
        raise FalVideoError(f"{model_id!r} is not an audio-driven avatar model")

    audio_sec = max(1.0, _wav_duration_seconds(audio_path))
    # Audio-driven avatar models cap the *input* voiceover length (e.g.
    # OmniHuman rejects audio beyond ~model.max_duration_sec). Raise
    # before ensure_can_spend/submit — this is a validation failure, not
    # a billable render, so it must never register spend.
    if audio_sec > model.max_duration_sec:
        raise FalVideoError(
            f"{model_id!r} audio input is {audio_sec:.1f}s, over its "
            f"{model.max_duration_sec}s cap — trim the voiceover or split "
            "the scene before rendering"
        )
    if spend is not None:
        await spend.ensure_can_spend(video_cost(model, audio_sec))

    body = {
        "image_url": _image_to_data_uri(keyframe_path),
        "audio_url": _audio_to_data_uri(audio_path),
        **model.extra_body,
    }

    async with _client() as client:
        queued = await _submit(client, model.id, body)
        await _await_completion(client, queued["status_url"])
        resp = await client.get(queued["response_url"])
        resp.raise_for_status()
        result = resp.json()
        video = result.get("video") or {}
        video_url = video.get("url")
        if not video_url:
            raise FalVideoError(f"completed but no video.url: {result!r}")
        await _download(client, video_url, out_path)

    if spend is not None:
        billed = float(video.get("duration") or audio_sec)
        await spend.log(
            provider=PROVIDER,
            sku=model.id,
            units=Decimal(str(billed)),
            cost_usd=video_cost(model, billed),
        )
    return out_path
