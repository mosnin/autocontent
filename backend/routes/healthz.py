"""Health-check endpoints.

/healthz       — cheap liveness probe, always 200 {"ok": true}.
/healthz/deep  — dependency readiness probe; 200 when all critical checks pass,
                 503 when any critical check fails.  Body is always returned so
                 monitors can inspect individual component state.

Critical checks (failures → 503):
  db         — asyncpg pool fetchval("select 1") with a 2 s timeout.
  clerk_jwks — HTTP HEAD to the configured JWKS URL with a 2 s timeout
               (skipped when MARKETER_CLERK_JWKS_URL is unset).
  migrations — pending migration count via yoyo; pending > 0 means the
               deploy was not preceded by ``marketer-migrate up`` and
               is treated as a configuration error (503).

Informational checks (non-critical, never affect the HTTP status):
  openai_api_key, xai_api_key, ayrshare_api_key — just report "configured"
  or "missing" so operators can verify env without calling upstreams.
"""
from __future__ import annotations

import asyncio
import time

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from marketer.config import settings
from marketer.db import get_pool

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict:
    """Cheap liveness probe — always 200."""
    return {"ok": True}


@router.get("/healthz/deep")
async def healthz_deep() -> JSONResponse:
    """Deep readiness probe — validates DB connectivity and Clerk JWKS."""
    checks: dict = {}
    all_critical_ok = True

    # ── DB probe ──────────────────────────────────────────────────────────────
    t0 = time.monotonic()
    try:
        pool = await asyncio.wait_for(get_pool(), timeout=2.0)
        await asyncio.wait_for(pool.fetchval("SELECT 1"), timeout=2.0)
        latency_ms = round((time.monotonic() - t0) * 1000)
        checks["db"] = {"ok": True, "latency_ms": latency_ms}
    except Exception as exc:  # noqa: BLE001
        latency_ms = round((time.monotonic() - t0) * 1000)
        checks["db"] = {"ok": False, "latency_ms": latency_ms, "error": str(exc)}
        all_critical_ok = False

    # ── Clerk JWKS probe ──────────────────────────────────────────────────────
    if settings.clerk_jwks_url:
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.head(settings.clerk_jwks_url)
            resp.raise_for_status()
            latency_ms = round((time.monotonic() - t0) * 1000)
            checks["clerk_jwks"] = {"ok": True, "latency_ms": latency_ms}
        except Exception as exc:  # noqa: BLE001
            latency_ms = round((time.monotonic() - t0) * 1000)
            checks["clerk_jwks"] = {"ok": False, "latency_ms": latency_ms, "error": str(exc)}
            all_critical_ok = False
    else:
        checks["clerk_jwks"] = {"ok": False, "error": "MARKETER_CLERK_JWKS_URL not set"}
        all_critical_ok = False

    # ── Migration status check ────────────────────────────────────────────────
    try:
        from scripts.migrate import status as migration_status  # noqa: PLC0415

        # migration_status() uses psycopg2 (sync); run in a thread to avoid
        # blocking the async event loop.
        loop = asyncio.get_event_loop()
        mig = await loop.run_in_executor(None, migration_status)
        checks["migrations"] = {"ok": mig["pending"] == 0, **mig}
        if mig["pending"] > 0:
            all_critical_ok = False
    except Exception as exc:  # noqa: BLE001
        checks["migrations"] = {"ok": False, "error": str(exc)}
        all_critical_ok = False

    # ── Optional API-key presence checks ─────────────────────────────────────
    checks["openai_api_key"] = {"configured": bool(settings.openai_api_key)}
    checks["xai_api_key"] = {"configured": bool(settings.xai_api_key)}
    checks["ayrshare_api_key"] = {"configured": bool(settings.ayrshare_api_key)}

    status_code = 200 if all_critical_ok else 503
    return JSONResponse(
        content={"ok": all_critical_ok, "checks": checks},
        status_code=status_code,
    )
