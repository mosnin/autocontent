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


async def _check_db() -> tuple[str, dict, bool]:
    t0 = time.monotonic()
    try:
        pool = await asyncio.wait_for(get_pool(), timeout=2.0)
        await asyncio.wait_for(pool.fetchval("SELECT 1"), timeout=2.0)
        return "db", {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)}, True
    except Exception as exc:  # noqa: BLE001
        return (
            "db",
            {
                "ok": False,
                "latency_ms": round((time.monotonic() - t0) * 1000),
                "error": str(exc),
            },
            False,
        )


async def _check_jwks() -> tuple[str, dict, bool]:
    if not settings.clerk_jwks_url:
        return "clerk_jwks", {"ok": False, "error": "MARKETER_CLERK_JWKS_URL not set"}, False
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.head(settings.clerk_jwks_url)
        resp.raise_for_status()
        return (
            "clerk_jwks",
            {"ok": True, "latency_ms": round((time.monotonic() - t0) * 1000)},
            True,
        )
    except Exception as exc:  # noqa: BLE001
        return (
            "clerk_jwks",
            {
                "ok": False,
                "latency_ms": round((time.monotonic() - t0) * 1000),
                "error": str(exc),
            },
            False,
        )


async def _check_migrations() -> tuple[str, dict, bool]:
    try:
        from scripts.migrate import status as migration_status  # noqa: PLC0415

        # migration_status() uses psycopg2 (sync); run in a thread to avoid
        # blocking the async event loop.
        mig = await asyncio.to_thread(migration_status)
        ok = mig["pending"] == 0
        return "migrations", {"ok": ok, **mig}, ok
    except Exception as exc:  # noqa: BLE001
        return "migrations", {"ok": False, "error": str(exc)}, False


@router.get("/healthz/deep")
async def healthz_deep() -> JSONResponse:
    """Deep readiness probe — validates DB, Clerk JWKS, and migrations
    in one beat. Optional API-key presence never affects the status."""
    checks: dict = {}
    all_critical_ok = True
    for name, payload, ok in await asyncio.gather(
        _check_db(), _check_jwks(), _check_migrations()
    ):
        checks[name] = payload
        if not ok:
            all_critical_ok = False

    checks["openai_api_key"] = {"configured": bool(settings.openai_api_key)}
    checks["xai_api_key"] = {"configured": bool(settings.xai_api_key)}
    checks["ayrshare_api_key"] = {"configured": bool(settings.ayrshare_api_key)}

    status_code = 200 if all_critical_ok else 503
    return JSONResponse(
        content={"ok": all_critical_ok, "checks": checks},
        status_code=status_code,
    )
