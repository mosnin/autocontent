"""Operational visibility: provider error rates, spend velocity, and
stuck/failed work — the "problems are seen before they compound" surface.

Admin-gated like `backend/routes/admin.py` (same `require_admin` dependency,
same style), but kept as its own router/module since this is a distinct
concern (ops telemetry) from account/RBAC administration.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from marketer.services import metrics as metrics_service

from ..auth import AdminCtx, CurrentAdmin

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/metrics", response_model=metrics_service.OpsSnapshot)
async def ops_metrics(
    ctx: AdminCtx = CurrentAdmin,
    error_window_minutes: int = Query(
        default=metrics_service.DEFAULT_ERROR_WINDOW_MINUTES, ge=5, le=30 * 24 * 60
    ),
    stuck_after_minutes: int = Query(
        default=metrics_service.DEFAULT_STUCK_AFTER_MINUTES, ge=1, le=7 * 24 * 60
    ),
) -> metrics_service.OpsSnapshot:
    """Real-time ops snapshot: spend velocity (1h/24h by provider), provider
    error rates over `error_window_minutes`, and stuck-work counts using
    `stuck_after_minutes` as the reap threshold. Every number is a live
    aggregate over `spend_ledger`/`jobs`/`image_posts` — nothing here is
    sampled or fabricated.
    """
    return await metrics_service.get_ops_snapshot(
        error_window_minutes=error_window_minutes,
        stuck_after_minutes=stuck_after_minutes,
    )


@router.get("/config-health")
async def ops_config_health(ctx: AdminCtx = CurrentAdmin) -> dict:
    """Config-health report (Cycle-2 Team 3's preflight helper), surfaced
    here so an operator can see "misconfigured integration" alongside
    "stuck jobs" and "provider errors" in one place.

    Imported defensively: if `marketer.services.preflight` isn't present in
    this checkout yet (or its shape changes), this degrades to an explicit
    `available: false` rather than 500ing the whole ops page.
    """
    try:
        from marketer.services.preflight import run_preflight
    except ImportError:
        log.debug("ops.config_health_unavailable: preflight module not found")
        return {"available": False}

    try:
        report = run_preflight()
    except Exception:  # noqa: BLE001 — never let this route 500 on a check bug
        log.warning("ops.config_health_failed", exc_info=True)
        return {"available": False}

    return {"available": True, **report.to_dict()}
