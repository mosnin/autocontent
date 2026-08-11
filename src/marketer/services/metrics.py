"""Ops metrics composition: turns the raw aggregations in
``marketer.repos.metrics`` into one serializable "ops snapshot", and — where
cheap — mirrors the same numbers into OTEL gauges so any connected APM
(Honeycomb/Datadog/Tempo/...) sees them too.

This module never talks to the database directly; it only composes repo
calls. Import-time and call-time are both safe when OTEL is disabled
(``MARKETER_OTEL_EXPORTER_OTLP_ENDPOINT`` unset) — ``opentelemetry.metrics``
returns a no-op meter/instruments in that case, so every ``.set()``/``.add()``
below is a harmless no-op rather than something we need to branch on.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from pydantic import BaseModel

from ..repos import metrics as metrics_repo

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# WARN thresholds. Centralized here so the API response and the web panel
# agree on what "needs attention" means without the frontend hardcoding it.
# ---------------------------------------------------------------------------
DEFAULT_ERROR_RATE_WARN = 0.15  # 15% of a provider's touched jobs/posts failed
DEFAULT_STUCK_AFTER_MINUTES = 120  # matches admin.system_health's 2h window
DEFAULT_ERROR_WINDOW_MINUTES = 24 * 60
DEFAULT_TOP_SKU_LIMIT = 10


class ProviderErrorRateOut(BaseModel):
    provider: str
    total: int
    failed: int
    error_rate: float
    warn: bool


class OpsThresholds(BaseModel):
    error_rate_warn: float
    stuck_after_minutes: int


class OpsSnapshot(BaseModel):
    generated_at: datetime
    db_ok: bool
    thresholds: OpsThresholds

    spend_1h: metrics_repo.SpendVelocity
    spend_24h: metrics_repo.SpendVelocity

    provider_error_rates: list[ProviderErrorRateOut]
    error_window_minutes: int

    stuck: metrics_repo.StuckWork

    top_skus: list[metrics_repo.TopSku]

    # Convenience rollups the web panel uses for top-line WARN badges,
    # computed here once instead of re-derived per-render on the client.
    any_provider_warn: bool
    any_stuck: bool


# ---------------------------------------------------------------------------
# OTEL instruments — created once, lazily, and reused across calls. Building
# them at import time would force `opentelemetry` init ordering; building
# them on first use keeps this module import-safe in any process (including
# the Modal pipeline, which imports `marketer.services.*` eagerly).
# ---------------------------------------------------------------------------
_instruments: dict[str, object] = {}


def _get_instruments() -> dict[str, object]:
    if _instruments:
        return _instruments
    try:
        from opentelemetry import metrics as otel_metrics
    except ImportError:  # pragma: no cover — otel is a hard dependency, but
        # stay defensive: metrics visibility must never break the endpoint.
        log.debug("ops_metrics.otel_unavailable")
        return {}

    meter = otel_metrics.get_meter("marketer.ops")
    try:
        _instruments.update(
            spend_usd=meter.create_gauge(
                "marketer.ops.spend_usd",
                description="Spend by provider over a trailing window, in USD.",
                unit="usd",
            ),
            provider_error_rate=meter.create_gauge(
                "marketer.ops.provider_error_rate",
                description="Failed / total jobs+image_posts touched per provider.",
                unit="1",
            ),
            stuck_count=meter.create_gauge(
                "marketer.ops.stuck_count",
                description="Jobs/image_posts stuck in a non-terminal state past the reap window.",
                unit="1",
            ),
        )
    except Exception:  # noqa: BLE001 — never let telemetry break the snapshot
        log.warning("ops_metrics.instrument_init_failed", exc_info=True)
        return {}
    return _instruments


def _emit_otel(snapshot: OpsSnapshot) -> None:
    instruments = _get_instruments()
    if not instruments:
        return
    try:
        spend_gauge = instruments["spend_usd"]
        for p in snapshot.spend_1h.by_provider:
            spend_gauge.set(float(p.cost_usd), {"provider": p.provider, "window": "1h"})
        for p in snapshot.spend_24h.by_provider:
            spend_gauge.set(float(p.cost_usd), {"provider": p.provider, "window": "24h"})

        error_gauge = instruments["provider_error_rate"]
        for per in snapshot.provider_error_rates:
            error_gauge.set(per.error_rate, {"provider": per.provider})

        stuck_gauge = instruments["stuck_count"]
        stuck_gauge.set(snapshot.stuck.jobs_stuck, {"kind": "jobs"})
        stuck_gauge.set(snapshot.stuck.image_posts_stuck, {"kind": "image_posts"})
    except Exception:  # noqa: BLE001 — telemetry is best-effort, never fatal
        log.warning("ops_metrics.otel_emit_failed", exc_info=True)


async def get_ops_snapshot(
    *,
    error_window_minutes: int = DEFAULT_ERROR_WINDOW_MINUTES,
    stuck_after_minutes: int = DEFAULT_STUCK_AFTER_MINUTES,
    error_rate_warn: float = DEFAULT_ERROR_RATE_WARN,
    top_sku_limit: int = DEFAULT_TOP_SKU_LIMIT,
) -> OpsSnapshot:
    """Compose the ops snapshot from independent, concurrent repo calls.

    Every field is a real aggregate — this function invents nothing; it only
    shapes and thresholds what the repo already computed.
    """
    (
        db_ok,
        spend_1h,
        spend_24h,
        error_rates,
        stuck,
        skus,
    ) = await asyncio.gather(
        metrics_repo.db_ok(),
        metrics_repo.spend_velocity(60),
        metrics_repo.spend_velocity(24 * 60),
        metrics_repo.provider_error_rates(error_window_minutes),
        metrics_repo.stuck_work(stuck_after_minutes),
        metrics_repo.top_skus(error_window_minutes, top_sku_limit),
    )

    error_rates_out = [
        ProviderErrorRateOut(
            provider=r.provider,
            total=r.total,
            failed=r.failed,
            error_rate=r.error_rate,
            warn=r.error_rate >= error_rate_warn and r.total > 0,
        )
        for r in error_rates
    ]

    snapshot = OpsSnapshot(
        generated_at=datetime.now(timezone.utc),
        db_ok=db_ok,
        thresholds=OpsThresholds(
            error_rate_warn=error_rate_warn,
            stuck_after_minutes=stuck_after_minutes,
        ),
        spend_1h=spend_1h,
        spend_24h=spend_24h,
        provider_error_rates=error_rates_out,
        error_window_minutes=error_window_minutes,
        stuck=stuck,
        top_skus=skus,
        any_provider_warn=any(r.warn for r in error_rates_out),
        any_stuck=(stuck.jobs_stuck > 0 or stuck.image_posts_stuck > 0),
    )

    _emit_otel(snapshot)
    return snapshot
