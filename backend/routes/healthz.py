"""Health-check endpoints.

/healthz       — cheap liveness probe, always 200 {"ok": true}.
/healthz/deep  — dependency readiness probe; 200 when all critical checks pass,
                 503 when any critical check fails.  Body is always returned so
                 monitors can inspect individual component state.

Critical checks (failures → 503):
  db         — asyncpg pool fetchval("select 1") with a 2 s timeout.
  auth_jwks  — HTTP GET of web's JWKS (MARKETER_AUTH_JWKS_URL, default
               {MARKETER_AUTH_ISSUER}/api/auth/jwks) with a 2 s timeout.
               Unconfigured counts as a failure: no JWT can be verified.
  migrations — pending migration count via yoyo; pending > 0 means the
               deploy was not preceded by ``marketer-migrate up`` and
               is treated as a configuration error (503).

Informational checks (non-critical, never affect the HTTP status):
  openai_api_key, xai_api_key, ayrshare_api_key — just report "configured"
  or "missing" so operators can verify env without calling upstreams.
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from marketer.config import settings
from marketer.db import get_pool

router = APIRouter()
log = logging.getLogger(__name__)


def _public_error(exc: BaseException) -> str:
    """What an unauthenticated probe may see about a failed check.

    This route has no auth (monitors call it), so the exception text stays in
    the server log: a driver error can carry the database host, user and
    database name, and an HTTP error the JWKS URL. The client gets the
    exception class only, which is enough to tell a timeout from a refusal."""
    log.warning("healthz.check_failed", exc_info=exc)
    return type(exc).__name__


@router.get("/healthz")
async def healthz() -> dict:
    """Cheap liveness probe — always 200."""
    return {"ok": True}


@router.get("/healthz/deep")
async def healthz_deep() -> JSONResponse:
    """Deep readiness probe — validates DB connectivity and the auth JWKS."""
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
        checks["db"] = {"ok": False, "latency_ms": latency_ms, "error": _public_error(exc)}
        all_critical_ok = False

    # ── Auth JWKS probe ───────────────────────────────────────────────────────
    jwks_url = settings.auth_jwks_url_effective()
    if jwks_url:
        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(jwks_url)
            resp.raise_for_status()
            latency_ms = round((time.monotonic() - t0) * 1000)
            checks["auth_jwks"] = {"ok": True, "latency_ms": latency_ms}
        except Exception as exc:  # noqa: BLE001
            latency_ms = round((time.monotonic() - t0) * 1000)
            checks["auth_jwks"] = {"ok": False, "latency_ms": latency_ms, "error": _public_error(exc)}
            all_critical_ok = False
    else:
        checks["auth_jwks"] = {"ok": False, "error": "not configured"}
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
        checks["migrations"] = {"ok": False, "error": _public_error(exc)}
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
