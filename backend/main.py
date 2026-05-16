from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import jobs, niches, spend, users


def create_app() -> FastAPI:
    app = FastAPI(title="autocontent api", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # TODO: restrict to web app origin
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
    app.include_router(niches.router, prefix="/api/v1/niches", tags=["niches"])
    app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
    app.include_router(spend.router, prefix="/api/v1/spend", tags=["spend"])

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    return app
