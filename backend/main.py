from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from marketer.config import settings
from marketer.logging import configure as _configure_logging

from .errors import (
    AppError,
    app_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from .idempotency_api import IdempotencyMiddleware
from .openapi import customize_openapi
from .rate_limit import limiter
from .routes import admin, ads, articles, billing, brand_kit, calendar, campaigns, connect, failures, healthz, image_posts, jobs, kits, library, metrics, niches, ops, performance, providers, spend, style_presets, templates, tokens, users, voices, webhook_endpoints, webhooks, x402

logger = logging.getLogger(__name__)


def _parse_origins(raw: str) -> list[str]:
    return [o.strip() for o in raw.split(",") if o.strip()]


def _run_boot_preflight() -> None:
    """Run the config-health preflight and log the report at boot.

    Non-fatal by default: a WARN/ERROR finding is visibility, not a
    gate — misconfiguration must never take an otherwise-working API
    down. When `settings.preflight_strict` is True, an ERROR-level
    finding raises instead, so operators who want "fail loud at deploy"
    can opt into it explicitly.
    """
    from marketer.services.preflight import run_preflight  # noqa: PLC0415

    try:
        report = run_preflight()
    except Exception:  # noqa: BLE001 — preflight itself must never break boot
        logger.error("preflight.crashed", exc_info=True)
        return

    for check in report.checks:
        message = f"preflight.{check.capability}: {check.message}"
        if check.status == "error":
            logger.error(message, extra=check.details)
        elif check.status == "warn":
            logger.warning(message, extra=check.details)
        else:
            logger.info(message)

    logger.info(
        "preflight.summary",
        extra={
            "overall_status": report.overall_status,
            "error_count": len(report.errors),
            "warn_count": len(report.warnings),
            "check_count": len(report.checks),
        },
    )

    if settings.preflight_strict and report.errors:
        names = ", ".join(c.capability for c in report.errors)
        raise RuntimeError(
            f"preflight_strict=True and config health report has ERROR(s): {names}"
        )


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _run_boot_preflight()
    yield


def create_app() -> FastAPI:
    _configure_logging()

    app = FastAPI(title="marketer api", version="0.1.0", lifespan=_lifespan)

    # ── Structured error envelope ─────────────────────────────────────────────
    # Every failure renders as {"error": {code, message, hint, retryable, ...}}
    # with an X-Request-ID correlation id. The HTTPException handler maps the
    # existing `raise HTTPException(...)` call sites into the envelope, so no
    # route had to change and nothing leaks on a 500.
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    # ── Rate limiting (must be registered before CORS middleware) ─────────────
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    origins = _parse_origins(settings.web_origin)
    if origins:
        allow_origins = origins
        allow_credentials = True
    else:
        logger.warning(
            "MARKETER_WEB_ORIGIN not set; falling back to '*' with "
            "allow_credentials=False. Configure for production."
        )
        allow_origins = ["*"]
        allow_credentials = False

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Idempotency-Key: exactly-once for mutating API/agent calls ────────────
    # A retried POST/PUT/PATCH/DELETE carrying an Idempotency-Key header is
    # deduped against the cycle-2 idempotency table and replays the original
    # response. GETs and header-less requests pass through untouched.
    app.add_middleware(IdempotencyMiddleware)

    app.include_router(healthz.router, prefix="", tags=["health"])
    app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
    app.include_router(niches.router, prefix="/api/v1/niches", tags=["niches"])
    app.include_router(performance.router, prefix="/api/v1/niches", tags=["performance"])
    app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
    app.include_router(articles.router, prefix="/api/v1/articles", tags=["articles"])
    app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])
    app.include_router(ads.router, prefix="/api/v1/ads", tags=["ads"])
    app.include_router(calendar.router, prefix="/api/v1/calendar", tags=["calendar"])
    app.include_router(brand_kit.router, prefix="/api/v1/brand-kit", tags=["brand-kit"])
    app.include_router(webhook_endpoints.router, prefix="/api/v1/webhook-endpoints", tags=["webhooks-out"])
    app.include_router(spend.router, prefix="/api/v1/spend", tags=["spend"])
    app.include_router(connect.router, prefix="/api/v1/connect", tags=["connect"])
    app.include_router(tokens.router, prefix="/api/v1/tokens", tags=["tokens"])
    app.include_router(voices.router, prefix="/api/v1/voices", tags=["voices"])
    app.include_router(billing.router, prefix="/api/v1/billing", tags=["billing"])
    app.include_router(metrics.router, prefix="/api/v1/metrics", tags=["metrics"])
    app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["webhooks"])
    app.include_router(x402.router, prefix="/api/v1/x402", tags=["x402"])
    app.include_router(library.router, prefix="/api/v1/library", tags=["library"])
    app.include_router(style_presets.router, prefix="/api/v1/style-presets", tags=["style-presets"])
    app.include_router(kits.router, prefix="/api/v1/kits", tags=["kits"])
    app.include_router(campaigns.router, prefix="/api/v1/campaigns", tags=["campaigns"])
    app.include_router(image_posts.router, prefix="/api/v1/image-posts", tags=["image-posts"])
    app.include_router(templates.router, prefix="/api/v1/templates", tags=["templates"])
    app.include_router(providers.router, prefix="/api/v1/providers", tags=["providers"])
    app.include_router(ops.router, prefix="/api/v1/ops", tags=["ops"])
    app.include_router(failures.router, prefix="/api/v1/failures", tags=["failures"])

    # Durable ad workflows (Inngest). No-op unless ads + Inngest are configured;
    # when enabled this serves the functions at /api/inngest.
    try:
        from marketer.services import inngest_app

        inngest_app.mount(app)
    except Exception:  # noqa: BLE001 — workflow wiring must never break boot
        logger.warning("inngest mount skipped", exc_info=True)

    # ── OpenTelemetry FastAPI per-app instrumentation ──────────────────────
    # Called AFTER routes are registered so the instrumentor captures the
    # full route table (needed for http.route attribute on spans).
    # The global TracerProvider was initialised by _configure_logging() →
    # init_tracing(). When OTEL is disabled the instrumentor is a no-op.
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # noqa: PLC0415

        FastAPIInstrumentor.instrument_app(app)
    except ImportError:
        pass  # package not installed; tracing stays disabled

    # ── OpenAPI: Bearer security scheme, tag groups, stable operationIds ──────
    # Called last so it sees the full route table. The exported spec (see
    # scripts/export_openapi.py) drives the TypeScript SDK + docs.
    customize_openapi(app)

    return app
