"""Cross-provider fallback for the two render-time calls that can strand
an otherwise-good video on a single vendor: scene animation (i2v /
avatar) and voiceover synthesis.

Wave-1 hardening made every provider's own `tenacity` retry predicate
transient-only (429/5xx/timeouts — never deterministic 4xx). That means
an exception that ESCAPES a provider call today is not "maybe retry
again", it's a real, persistent problem with that one vendor: a rotated
key, a deprecated model, a content-policy rejection, an extended outage.
The correct response to a persistent single-provider failure is not to
fail the whole scene/job — it's to render the same thing through a
DIFFERENT provider. This module owns that decision.

Policy
------
* Fallback means a DIFFERENT provider. The provider's own transient
  retries already ran inside its own module; we never call the same
  provider+model twice in a row here.
* Avatar (lip-synced UGC) jobs NEVER fall back to a plain i2v model —
  that would silently drop the entire UGC format (no lip-synced audio)
  instead of failing loudly. Avatar falls back only to another enabled
  avatar model, or raises ``AvatarFallbackUnavailable``.
* ``SpendCapExceeded`` always propagates untouched, from any attempt.
  A cap breach is a real-money guardrail, not a provider problem — it is
  never something to "fall back" past.
* Every attempt (success or failure) is logged as structured JSON via
  the standard logger; spend is metered under whichever provider actually
  produced the artifact (each provider module's own ``spend.log`` call
  handles this naturally, since a failed attempt raises before its
  ``spend.log`` and a fallback attempt logs its own cost independently).
* Fallback is on by default (the safer choice — a stranded job is worse
  than an unexpected provider swap) but can be disabled per niche via
  ``niche.provider_fallback_enabled`` when that field exists on the row;
  accessed with ``getattr(..., default=True)`` since the field is not
  (yet) part of the Niche schema — this module does not own schemas.py.

Chains
------
* Video i2v: niche's chosen model -> safe default. The safe default is
  Grok Imagine (xAI) when ``MARKETER_XAI_API_KEY`` is configured (it's
  provider-agnostic to whatever fal model the niche picked); otherwise
  the cheapest *enabled* fal i2v model. When the niche's primary IS grok
  itself, the only meaningful fallback is the cheapest enabled fal i2v
  model (falling back to grok-from-grok would just retry the same
  provider, which is not fallback).
* Video avatar: niche's chosen avatar model -> any other *enabled*
  avatar model. If none exists, fail clearly rather than silently
  rendering non-avatar i2v.
* TTS: elevenlabs -> openai_tts. openai_tts is the stock engine
  (effectively always available — no key gate) so it never itself falls
  further; a niche already on openai_tts has nothing to fall back to.
"""
from __future__ import annotations

from pathlib import Path
from typing import Awaitable, Callable

from ..logging import get_logger
from ..models import Niche
from ..repos.spend import SpendCapExceeded
from . import elevenlabs_tts, grok_imagine, openai_tts, provider_limits
from .fal_video import FalVideoModel
from .spend_context import SpendContext

log = get_logger(__name__)


class VideoFallbackExhausted(RuntimeError):
    """Every candidate provider in the i2v fallback chain failed."""


class AvatarFallbackUnavailable(RuntimeError):
    """The niche's avatar model failed and no alternate avatar model is
    enabled. Deliberately NOT a fallback to i2v — that would silently
    drop the lip-synced UGC format instead of failing clearly."""


class TTSFallbackExhausted(RuntimeError):
    """Every candidate provider in the TTS fallback chain failed."""


def fallback_enabled(niche: Niche) -> bool:
    """Per-niche opt-out. Defaults to enabled (the safer choice) since
    the field doesn't exist on the schema this module owns editing — a
    row with no such attribute, or an explicit ``True``, behaves
    identically. Set ``provider_fallback_enabled=False`` on a niche row
    (once the orchestrator adds the column) to pin it to its configured
    provider only, e.g. for a niche that must never silently switch
    voices/models."""
    return bool(getattr(niche, "provider_fallback_enabled", True))


def _enabled_fal_i2v_models() -> list[FalVideoModel]:
    from . import fal_video

    if not fal_video.enabled():
        return []
    return [m for m in fal_video.list_models() if m.kind == "i2v"]


def _cheapest_fal_i2v(*, exclude_model_id: str | None = None) -> FalVideoModel | None:
    candidates = [m for m in _enabled_fal_i2v_models() if m.id != exclude_model_id]
    if not candidates:
        return None
    return min(candidates, key=lambda m: m.usd_per_second)


def i2v_fallback_chain(niche: Niche) -> list[tuple[str, str | None]]:
    """Ordered ``(provider, model_id)`` candidates for scene i2v render.

    ``provider`` is ``"grok"`` (model_id always ``None`` — grok_imagine
    has one model) or ``"fal"`` (model_id names the fal model). Length is
    1 (no viable fallback target) or 2 (primary + safe default) — never
    more, and never a repeat of an already-listed (provider, model_id).
    """
    from ..config import settings

    if niche.video_provider == "fal" and niche.fal_model:
        primary: tuple[str, str | None] = ("fal", niche.fal_model)
    else:
        primary = ("grok", None)

    chain = [primary]
    if primary[0] == "grok":
        # The primary already IS the safe-default provider; the only
        # genuinely different fallback is a fal i2v model.
        cheapest = _cheapest_fal_i2v()
        if cheapest is not None:
            chain.append(("fal", cheapest.id))
    else:
        if bool(settings.xai_api_key):
            chain.append(("grok", None))
        else:
            cheapest = _cheapest_fal_i2v(exclude_model_id=primary[1])
            if cheapest is not None:
                chain.append(("fal", cheapest.id))
    return chain


def avatar_fallback_chain(avatar_model_id: str) -> list[str]:
    """Ordered avatar model ids: the niche's chosen avatar model first,
    then any OTHER *enabled* avatar model. Never includes an i2v model —
    see the module docstring's avatar policy."""
    from . import fal_video

    chain = [avatar_model_id]
    if fal_video.enabled():
        others = [
            m.id
            for m in fal_video.list_models()
            if m.kind == "avatar" and m.id != avatar_model_id
        ]
        chain.extend(others)
    return chain


async def _render_i2v_once(
    provider: str,
    model_id: str | None,
    keyframe_path: Path,
    motion_prompt: str,
    out_path: Path,
    *,
    niche: Niche,
    duration_sec: float,
    spend: SpendContext,
) -> None:
    if provider == "fal":
        from . import fal_video

        async with provider_limits.slot("fal"):
            await fal_video.animate(
                keyframe_path, motion_prompt, out_path,
                model_id=model_id, duration_sec=duration_sec, spend=spend,
            )
    else:
        async with provider_limits.slot("grok"):
            await grok_imagine.animate(
                keyframe_path, motion_prompt, out_path,
                duration_sec=duration_sec, resolution=niche.video_resolution, spend=spend,
            )


async def render_i2v_scene(
    keyframe_path: Path,
    motion_prompt: str,
    out_path: Path,
    *,
    niche: Niche,
    duration_sec: float,
    spend: SpendContext,
) -> None:
    """Render one scene's i2v clip at ``out_path``, falling back to a
    different provider when the niche's chosen provider raises a
    persistent (non-transient — its own retry already ran) error.

    ``SpendCapExceeded`` always propagates immediately; it is never a
    reason to try the next provider."""
    chain = i2v_fallback_chain(niche) if fallback_enabled(niche) else [
        (
            ("fal", niche.fal_model)
            if niche.video_provider == "fal" and niche.fal_model
            else ("grok", None)
        )
    ]
    last_exc: BaseException | None = None
    for attempt, (provider, model_id) in enumerate(chain, start=1):
        try:
            await _render_i2v_once(
                provider, model_id, keyframe_path, motion_prompt, out_path,
                niche=niche, duration_sec=duration_sec, spend=spend,
            )
            if attempt > 1:
                log.warning(
                    "video.fallback.succeeded",
                    extra={
                        "provider": provider, "sku": model_id or grok_imagine.SKU,
                        "attempt": attempt, "chain_len": len(chain),
                    },
                )
            return
        except SpendCapExceeded:
            raise
        except Exception as exc:  # noqa: BLE001 — try the next provider
            last_exc = exc
            log.warning(
                "video.fallback.attempt_failed",
                extra={
                    "provider": provider, "sku": model_id or grok_imagine.SKU,
                    "attempt": attempt, "chain_len": len(chain), "error": str(exc),
                },
            )
            if len(chain) == 1:
                # No fallback target existed at all (disabled, or no
                # alternate provider configured) — surface the original
                # error untouched rather than wrapping a single failure.
                raise
    raise VideoFallbackExhausted(
        f"all {len(chain)} video provider(s) failed for this scene "
        f"(chain={chain}); last error: {last_exc}"
    ) from last_exc


async def render_avatar_scene(
    keyframe_path: Path,
    audio_path: Path,
    out_path: Path,
    *,
    niche: Niche,
    avatar_model_id: str,
    spend: SpendContext,
) -> None:
    """Render one lip-synced avatar clip, falling back only to another
    avatar model — never to a plain i2v model. Raises
    ``AvatarFallbackUnavailable`` (not ``VideoFallbackExhausted``) if
    every avatar candidate fails, so callers can tell the two failure
    modes apart."""
    from . import fal_video

    chain = (
        avatar_fallback_chain(avatar_model_id)
        if fallback_enabled(niche)
        else [avatar_model_id]
    )
    last_exc: BaseException | None = None
    for attempt, model_id in enumerate(chain, start=1):
        try:
            async with provider_limits.slot("fal"):
                await fal_video.animate_avatar(
                    keyframe_path, audio_path, out_path, model_id=model_id, spend=spend,
                )
            if attempt > 1:
                log.warning(
                    "avatar.fallback.succeeded",
                    extra={"provider": "fal", "sku": model_id, "attempt": attempt,
                           "chain_len": len(chain)},
                )
            return
        except SpendCapExceeded:
            raise
        except Exception as exc:  # noqa: BLE001 — try the next avatar model
            last_exc = exc
            log.warning(
                "avatar.fallback.attempt_failed",
                extra={"provider": "fal", "sku": model_id, "attempt": attempt,
                       "chain_len": len(chain), "error": str(exc)},
            )
    raise AvatarFallbackUnavailable(
        f"avatar model {avatar_model_id!r} failed and no alternate avatar "
        f"model is available (tried {len(chain)}) — refusing to fall back "
        "to a non-avatar (i2v) model, which would silently drop lip-sync; "
        f"last error: {last_exc}"
    ) from last_exc


async def synthesize_vo_with_fallback(
    text: str,
    out_path: Path,
    *,
    niche: Niche,
    spend: SpendContext,
) -> Path:
    """Voiceover through the niche's chosen TTS engine, falling back
    elevenlabs -> openai_tts on a persistent elevenlabs failure (missing/
    rotated key, content rejection, extended outage). openai_tts is the
    stock engine and has no further fallback target of its own."""
    attempts: list[tuple[str, Callable[[], Awaitable[Path]]]] = []

    async def _openai_call() -> Path:
        async with provider_limits.slot("openai_tts"):
            return await openai_tts.synthesize(
                text, out_path,
                voice=niche.voice,
                style_directions=niche.tts_style_directions,
                spend=spend,
            )

    async def _elevenlabs_call() -> Path:
        async with provider_limits.slot("elevenlabs"):
            return await elevenlabs_tts.synthesize(
                text, out_path, voice_id=niche.elevenlabs_voice_id, spend=spend,
            )

    if niche.voice_provider == "elevenlabs":
        attempts.append(("elevenlabs", _elevenlabs_call))
        if fallback_enabled(niche):
            attempts.append(("openai", _openai_call))
    else:
        attempts.append(("openai", _openai_call))

    last_exc: BaseException | None = None
    for attempt, (provider, call) in enumerate(attempts, start=1):
        try:
            result = await call()
            if attempt > 1:
                log.warning(
                    "tts.fallback.succeeded",
                    extra={"provider": provider, "attempt": attempt,
                           "chain_len": len(attempts)},
                )
            return result
        except SpendCapExceeded:
            raise
        except Exception as exc:  # noqa: BLE001 — try the next TTS provider
            last_exc = exc
            log.warning(
                "tts.fallback.attempt_failed",
                extra={"provider": provider, "attempt": attempt,
                       "chain_len": len(attempts), "error": str(exc)},
            )
    raise TTSFallbackExhausted(
        f"all {len(attempts)} TTS provider(s) failed; last error: {last_exc}"
    ) from last_exc
