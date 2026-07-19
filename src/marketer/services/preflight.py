"""Boot-time config health report.

Providers, generative features and money-moving integrations in this
codebase are all config-gated: a niche can select a video/voice/script
provider, or an operator can flip a feature flag, without the matching
secret ever being set. Today that surfaces as a runtime failure mid-job
(sometimes mid-spend) the first time the code path is actually hit.

This module builds a structured report — one entry per capability —
categorised OK / WARN / ERROR, so a misconfigured deploy is visible in
the boot logs (and, via `run_preflight()`, to an ops endpoint) instead
of being discovered by a failed pipeline run.

Deliberately reuses each service's own `enabled()`/`is_enabled()`
predicate rather than re-deriving the gating logic here — preflight
must never drift from what the pipeline actually checks at call time.

Non-fatal by default: `run_preflight()` never raises. Callers that want
"abort boot on ERROR" opt in explicitly (see `backend.main`'s startup
hook, gated on `settings.preflight_strict`).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from ..config import settings

Status = Literal["ok", "warn", "error"]

_RANK: dict[Status, int] = {"ok": 0, "warn": 1, "error": 2}


@dataclass(frozen=True)
class CheckResult:
    """One capability's config-health finding."""

    capability: str
    status: Status
    message: str
    # Serializable extra context (e.g. which fields are missing). Kept
    # JSON-safe (str/int/float/bool/None/list/dict only).
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "capability": self.capability,
            "status": self.status,
            "message": self.message,
            "details": self.details,
        }


@dataclass(frozen=True)
class PreflightReport:
    """The full config-health report: one CheckResult per capability."""

    checks: tuple[CheckResult, ...]

    @property
    def overall_status(self) -> Status:
        if not self.checks:
            return "ok"
        worst = max(self.checks, key=lambda c: _RANK[c.status])
        return worst.status

    @property
    def errors(self) -> tuple[CheckResult, ...]:
        return tuple(c for c in self.checks if c.status == "error")

    @property
    def warnings(self) -> tuple[CheckResult, ...]:
        return tuple(c for c in self.checks if c.status == "warn")

    def to_dict(self) -> dict[str, Any]:
        return {
            "overall_status": self.overall_status,
            "checks": [c.to_dict() for c in self.checks],
        }


def _ok(capability: str, message: str, **details: Any) -> CheckResult:
    return CheckResult(capability=capability, status="ok", message=message, details=details)


def _warn(capability: str, message: str, **details: Any) -> CheckResult:
    return CheckResult(capability=capability, status="warn", message=message, details=details)


def _error(capability: str, message: str, **details: Any) -> CheckResult:
    return CheckResult(capability=capability, status="error", message=message, details=details)


# ---------------------------------------------------------------------------
# Individual capability checks
# ---------------------------------------------------------------------------

def check_openai() -> CheckResult:
    """Stock LLM + TTS + image path. Nothing else works without this."""
    if settings.openai_api_key:
        return _ok("openai", "OpenAI API key configured (stock LLM/TTS/image path).")
    return _error(
        "openai",
        "MARKETER_OPENAI_API_KEY is not set — the default agent pipeline "
        "(scripting, OpenAI TTS, hero images) cannot run.",
    )


def check_xai_video() -> CheckResult:
    """Grok Imagine is the default (non-fal) animation backend."""
    if settings.xai_api_key:
        return _ok("video.grok", "xAI API key configured (Grok Imagine, default video backend).")
    return _warn(
        "video.grok",
        "MARKETER_XAI_API_KEY is not set — the default Grok Imagine video "
        "backend is unavailable; niches must select an alternative "
        "(e.g. fal) or video generation will fail.",
    )


def check_fal_video() -> CheckResult:
    from . import fal_video  # deferred: keeps preflight import-order-safe

    if fal_video.enabled():
        return _ok("video.fal", "Fal API key configured — Fal video models available.")
    return _warn(
        "video.fal",
        "MARKETER_FAL_API_KEY is not set — a niche selecting the fal "
        "video provider will fail at submit time instead of falling back.",
    )


def check_fal_price_overrides() -> CheckResult:
    """Validate MARKETER_FAL_PRICE_OVERRIDES shape at boot.

    Complements fal_video._price_overrides()'s per-call warn-logging
    (Cycle-1) by surfacing the same drift once, loudly, at startup —
    rather than only the first time a fal render happens to run.
    """
    raw = settings.fal_price_overrides
    if not raw:
        return _ok("fal_price_overrides", "No fal price overrides set — pinned registry prices apply.")

    from . import fal_video  # deferred

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        return _error(
            "fal_price_overrides",
            "MARKETER_FAL_PRICE_OVERRIDES is not valid JSON — it will be "
            "ignored at call time (stale/pinned prices apply silently).",
            error=str(exc),
        )
    if not isinstance(parsed, dict):
        return _error(
            "fal_price_overrides",
            f"MARKETER_FAL_PRICE_OVERRIDES must be a JSON object, got "
            f"{type(parsed).__name__} — it will be ignored at call time.",
        )

    known_ids = {m.id for m in fal_video.FAL_VIDEO_MODELS}
    bad_keys: list[str] = []
    bad_values: dict[str, str] = {}
    unknown_keys: list[str] = []
    good = 0
    for key, val in parsed.items():
        if not isinstance(key, str):
            bad_keys.append(repr(key))
            continue
        try:
            price = Decimal(str(val))
        except (InvalidOperation, ValueError):
            bad_values[key] = repr(val)
            continue
        if price <= 0:
            bad_values[key] = repr(val)
            continue
        if key not in known_ids:
            unknown_keys.append(key)
        good += 1

    if bad_keys or bad_values:
        return _error(
            "fal_price_overrides",
            "MARKETER_FAL_PRICE_OVERRIDES has unparseable or non-positive "
            "entries that will be dropped at call time — price drift is "
            "not actually corrected for those models.",
            bad_keys=bad_keys,
            bad_values=bad_values,
            valid_entries=good,
        )
    if unknown_keys:
        return _warn(
            "fal_price_overrides",
            "MARKETER_FAL_PRICE_OVERRIDES references model ids that are "
            "not in the current fal registry — those entries have no "
            "effect (typo, or a model retired from the registry).",
            unknown_keys=unknown_keys,
            valid_entries=good,
        )
    return _ok(
        "fal_price_overrides",
        f"MARKETER_FAL_PRICE_OVERRIDES parsed cleanly ({good} override(s)).",
        valid_entries=good,
    )


def check_openrouter() -> CheckResult:
    from . import openrouter

    if openrouter.enabled():
        return _ok("script.openrouter", "OpenRouter API key configured — alternate scriptwriter models available.")
    return _warn(
        "script.openrouter",
        "MARKETER_OPENROUTER_API_KEY is not set — a niche selecting an "
        "OpenRouter script model falls back to the stock agent_model "
        "instead of the model actually chosen.",
    )


def check_elevenlabs_voice() -> CheckResult:
    from . import elevenlabs_tts

    if elevenlabs_tts.enabled():
        return _ok("tts.elevenlabs", "ElevenLabs API key configured — premium voice provider available.")
    return _warn(
        "tts.elevenlabs",
        "MARKETER_ELEVENLABS_API_KEY is not set — a niche selecting the "
        "ElevenLabs voice provider will fail loudly at synth time instead "
        "of silently downgrading.",
    )


def check_generated_music() -> CheckResult:
    from . import music_gen

    if music_gen.enabled():
        return _ok("music.generated", "ElevenLabs API key configured — generative background music available.")
    return _warn(
        "music.generated",
        "MARKETER_ELEVENLABS_API_KEY is not set — generative background "
        "music is unavailable; the pipeline falls back to the stock "
        "library/Pixabay/silent chain (non-fatal, but reduced quality).",
    )


def check_object_storage() -> CheckResult:
    from . import object_storage

    if object_storage.enabled():
        return _ok("object_storage.wasabi", "Wasabi object storage fully configured (enabled + bucket + keys).")

    if not settings.wasabi_enabled:
        return _ok("object_storage.wasabi", "Wasabi object storage disabled — volume-only media storage.")

    missing = [
        name
        for name, val in (
            ("wasabi_bucket", settings.wasabi_bucket),
            ("wasabi_access_key_id", settings.wasabi_access_key_id),
            ("wasabi_secret_access_key", settings.wasabi_secret_access_key),
        )
        if not val
    ]
    return _error(
        "object_storage.wasabi",
        "MARKETER_WASABI_ENABLED is true but required field(s) are "
        "missing — object storage is inert and every upload/presign call "
        "will raise ObjectStorageDisabled at runtime.",
        missing=missing,
    )


def check_billing() -> CheckResult:
    if not settings.billing_enabled:
        return _ok("billing", "Billing disabled — hosted-product credit/debit path inactive.")
    missing = [
        name
        for name, val in (
            ("stripe_secret_key", settings.stripe_secret_key),
            ("stripe_webhook_secret", settings.stripe_webhook_secret),
        )
        if not val
    ]
    if missing:
        return _error(
            "billing",
            "MARKETER_BILLING_ENABLED is true but Stripe credential(s) are "
            "missing — checkout/webhook handling cannot function.",
            missing=missing,
        )
    return _ok("billing", "Billing enabled with Stripe credentials configured.")


def check_ads() -> CheckResult:
    if not settings.ads_enabled:
        return _ok("ads", "Ads product disabled.")
    if not settings.composio_api_key:
        return _error(
            "ads",
            "MARKETER_ADS_ENABLED is true but MARKETER_COMPOSIO_API_KEY is "
            "not set — the ads product is enabled but Composio (agent tool "
            "access + OAuth) cannot be reached.",
        )
    warnings: list[str] = []
    if not settings.composio_googleads_auth_config_id:
        warnings.append("composio_googleads_auth_config_id")
    if not settings.composio_metaads_auth_config_id:
        warnings.append("composio_metaads_auth_config_id")
    if warnings:
        return _warn(
            "ads",
            "Ads enabled with Composio configured, but some platform auth "
            "config ids are unset — those platforms can't be connected.",
            missing_auth_configs=warnings,
        )
    return _ok("ads", "Ads enabled with Composio and both ad-platform auth configs set.")


def check_inngest() -> CheckResult:
    if not settings.ads_enabled:
        return _ok("inngest", "Ads product disabled — durable ad workflows inactive.")
    missing = [
        name
        for name, val in (
            ("inngest_signing_key", settings.inngest_signing_key),
            ("inngest_event_key", settings.inngest_event_key),
        )
        if not val
    ]
    if missing and not settings.inngest_dev:
        return _error(
            "inngest",
            "Ads is enabled but Inngest key(s) are missing (and "
            "inngest_dev is False) — durable ad workflows cannot run in "
            "production.",
            missing=missing,
        )
    if missing and settings.inngest_dev:
        return _warn(
            "inngest",
            "Inngest key(s) missing but inngest_dev=True — acceptable "
            "against a local dev server only, not production.",
            missing=missing,
        )
    return _ok("inngest", "Inngest signing/event keys configured for durable ad workflows.")


def check_x402() -> CheckResult:
    from . import x402

    if not settings.x402_enabled:
        return _ok("x402", "x402 agent payments disabled.")
    if x402.is_enabled():
        return _ok("x402", "x402 enabled with pay-to address and asset configured.")
    missing = [
        name
        for name, val in (
            ("x402_pay_to", settings.x402_pay_to),
            ("x402_asset", settings.x402_asset),
        )
        if not val
    ]
    return _error(
        "x402",
        "MARKETER_X402_ENABLED is true but required field(s) are missing "
        "— agents cannot fund prepaid credit over HTTP 402.",
        missing=missing,
    )


_CHECKS = (
    check_openai,
    check_xai_video,
    check_fal_video,
    check_fal_price_overrides,
    check_openrouter,
    check_elevenlabs_voice,
    check_generated_music,
    check_object_storage,
    check_billing,
    check_ads,
    check_inngest,
    check_x402,
)


def run_preflight() -> PreflightReport:
    """Pure function: build the full config-health report.

    Never raises — a check that itself blows up (e.g. an import error in
    a service module) is captured as an ERROR entry for that capability
    rather than aborting the whole report. Safe to call from a FastAPI
    startup hook, a CLI, or an admin endpoint (Team 4 owns wiring the
    route; this stays a plain function returning a serializable
    structure).
    """
    results: list[CheckResult] = []
    for check in _CHECKS:
        try:
            results.append(check())
        except Exception as exc:  # noqa: BLE001 — a failing check must not crash preflight
            results.append(
                _error(
                    getattr(check, "__name__", "unknown"),
                    f"preflight check raised unexpectedly: {exc!r}",
                )
            )
    return PreflightReport(checks=tuple(results))
