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
from .routes import admin, articles, billing, calendar, connect, healthz, jobs, metrics, niches, performance, spend, tokens, users, voices, webhooks

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
    app.include_router(calendar.router, prefix="/api/v1/calendar", tags=["calendar"])
    app.include_router(spend.router, prefix="/api/v1/spend", tags=["spend"])
    app.include_router(connect.router, prefix="/api/v1/connect", tags=["connect"])
    app.include_router(tokens.router, prefix="/api/v1/tokens", tags=["tokens"])
    app.include_router(voices.router, prefix="/api/v1/voices", tags=["voices"])
    app.include_router(billing.router, prefix="/api/v1/billing", tags=["billing"])
    app.include_router(metrics.router, prefix="/api/v1/metrics", tags=["metrics"])
    app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["webhooks"])

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
