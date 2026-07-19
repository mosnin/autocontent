from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from marketer.config import settings
from marketer.logging import configure as _configure_logging

from .rate_limit import limiter
from .routes import admin, ads, articles, billing, brand_kit, calendar, campaigns, connect, healthz, jobs, kits, library, metrics, niches, performance, providers, spend, style_presets, tokens, users, voices, webhook_endpoints, webhooks, x402

logger = logging.getLogger(__name__)


def _parse_origins(raw: str) -> list[str]:
    return [o.strip() for o in raw.split(",") if o.strip()]


def create_app() -> FastAPI:
    _configure_logging()

    app = FastAPI(title="marketer api", version="0.1.0")

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
    app.include_router(providers.router, prefix="/api/v1/providers", tags=["providers"])

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

    return app
