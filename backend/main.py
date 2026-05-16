from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from autocontent.config import settings

from .routes import connect, jobs, niches, spend, tokens, users

logger = logging.getLogger(__name__)


def _parse_origins(raw: str) -> list[str]:
    return [o.strip() for o in raw.split(",") if o.strip()]


def create_app() -> FastAPI:
    app = FastAPI(title="autocontent api", version="0.1.0")

    origins = _parse_origins(settings.web_origin)
    if origins:
        allow_origins = origins
        allow_credentials = True
    else:
        logger.warning(
            "AUTOCONTENT_WEB_ORIGIN not set; falling back to '*' with "
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

    app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
    app.include_router(niches.router, prefix="/api/v1/niches", tags=["niches"])
    app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
    app.include_router(spend.router, prefix="/api/v1/spend", tags=["spend"])
    app.include_router(connect.router, prefix="/api/v1/connect", tags=["connect"])
    app.include_router(tokens.router, prefix="/api/v1/tokens", tags=["tokens"])

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    return app
