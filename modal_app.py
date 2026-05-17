"""Modal app entrypoint.

Hosts two surfaces in one app:
- `run_pipeline(user_id, niche_id, platform)` — one Job, end-to-end.
- `nightly_batch()` — cron that enqueues one Job per active niche.
- `api` — FastAPI ASGI app for the web UI to call.

Local dev:
    modal run modal_app.py::run_pipeline \\
        --user-id user_123 --niche-id <uuid> --platform tiktok
Deploy:
    modal deploy modal_app.py
"""
from __future__ import annotations

import modal

# Initialise JSON logging + Sentry at import time so any error during
# Modal container startup is captured before user code runs.
from autocontent.logging import configure as _configure_logging

# Import settings before any @app.function decorator so that
# pipeline_global_concurrency is resolved at deploy time.
from autocontent.config import settings as _settings

_configure_logging()

APP_NAME = "autocontent"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install_from_pyproject("pyproject.toml")
    .add_local_python_source("autocontent", "backend", "scripts")
)

artifacts = modal.Volume.from_name("autocontent-artifacts", create_if_missing=True)
assets = modal.Volume.from_name("autocontent-assets", create_if_missing=True)

secrets = [
    modal.Secret.from_name("autocontent-openai"),    # OPENAI_API_KEY
    modal.Secret.from_name("autocontent-xai"),       # XAI_API_KEY
    modal.Secret.from_name("autocontent-ayrshare"),  # AYRSHARE_API_KEY
    modal.Secret.from_name("autocontent-supabase"),  # AUTOCONTENT_DATABASE_URL
    modal.Secret.from_name("autocontent-clerk"),     # AUTOCONTENT_CLERK_JWKS_URL + ISSUER
]

app = modal.App(APP_NAME, image=image, secrets=secrets)


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    timeout=60 * 60,
    concurrency_limit=_settings.pipeline_global_concurrency,
)
async def run_pipeline(user_id: str, niche_id: str, platform: str) -> dict:
    from uuid import UUID
    from autocontent.pipeline import run_job

    job = await run_job(user_id=user_id, niche_id=UUID(niche_id), platform=platform)
    artifacts.commit()
    return job.model_dump(mode="json")


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    schedule=modal.Cron("*/30 * * * *"),  # poll every 30 min; per-niche windows decide
    timeout=60 * 60 * 3,
)
async def nightly_batch() -> list[dict]:
    """Walk every user's active niches and spawn one Job per niche
    whose next posting window falls within the next ~30 min."""
    import asyncio
    from datetime import datetime, timedelta, timezone
    from autocontent.db import get_pool
    from autocontent.repos import niches as niches_repo

    pool = await get_pool()
    rows = await pool.fetch("select id from users")
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(minutes=30)

    coros = []
    for r in rows:
        user_id = r["id"]
        for niche in await niches_repo.list_for_user(user_id):
            # Scan a week of forward windows so we don't silently miss
            # a slot whose tz puts today's instance in the past (or
            # tomorrow's instance closer than today's). The horizon is
            # still 30 min, but we evaluate each window across 0..7 days
            # and let the comparison decide.
            for offset in range(0, 8):
                day = now + timedelta(days=offset)
                for w in niche.posting_windows:
                    slot = w.at(day).astimezone(timezone.utc)
                    if now <= slot < horizon:
                        for platform in niche.platforms:
                            coros.append(run_pipeline.remote.aio(
                                user_id, str(niche.id), platform
                            ))
    return list(await asyncio.gather(*coros)) if coros else []


@app.function(
    volumes={"/artifacts": artifacts},
    schedule=modal.Cron("0 9 * * *"),  # 09:00 UTC daily
    timeout=60 * 30,
)
def gc_artifacts() -> dict:
    """Daily GC: delete job artifact dirs older than 30 days.
    DB rows in `jobs` and `spend_ledger` are untouched."""
    from autocontent.storage.retention import gc_artifacts as _gc

    result = _gc(max_age_days=30)
    artifacts.commit()
    return {
        "scanned": result.scanned,
        "removed": result.removed,
        "bytes_freed": result.bytes_freed,
    }


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    timeout=60,
    min_containers=1,
)
@modal.asgi_app()
def api():
    from backend.main import create_app
    return create_app()


@app.function(
    timeout=120,
)
def apply_migrations() -> dict:
    """Apply all pending database migrations via yoyo-migrations.

    This function is idempotent: yoyo records applied migrations in the
    ``_yoyo_migration`` table and skips them on subsequent runs.

    Deploy flow
    -----------
    Run this *before* ``modal deploy`` so the schema is updated before new
    application code goes live::

        modal run modal_app.py::apply_migrations
        modal deploy modal_app.py
    """
    from scripts.migrate import status as migration_status  # noqa: PLC0415
    from scripts.migrate import up as migration_up  # noqa: PLC0415

    migration_up()
    return migration_status()


@app.local_entrypoint()
def main(user_id: str, niche_id: str, platform: str = "tiktok"):
    print(run_pipeline.remote(user_id, niche_id, platform))
