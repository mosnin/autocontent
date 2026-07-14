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
from marketer.logging import configure as _configure_logging

# Import settings before any @app.function decorator so that
# pipeline_global_concurrency is resolved at deploy time.
from marketer.config import settings as _settings

_configure_logging()

APP_NAME = "marketer-sh"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install_from_pyproject("pyproject.toml")
    .add_local_python_source("marketer", "backend", "scripts")
)

artifacts = modal.Volume.from_name("marketer-artifacts", create_if_missing=True)
assets = modal.Volume.from_name("marketer-assets", create_if_missing=True)

secrets = [
    # OPENAI_API_KEY; also carries the optional article-pipeline vars
    # (MARKETER_EXA_API_KEY, MARKETER_ARTICLE_WRITER_MODEL,
    # MARKETER_ARTICLE_HERO_IMAGE) — unset Exa degrades SERP research
    # to model knowledge rather than failing runs.
    modal.Secret.from_name("marketer-openai"),
    modal.Secret.from_name("marketer-xai"),       # XAI_API_KEY
    modal.Secret.from_name("marketer-ayrshare"),  # AYRSHARE_API_KEY
    modal.Secret.from_name("marketer-supabase"),  # MARKETER_DATABASE_URL
    modal.Secret.from_name("marketer-clerk"),     # MARKETER_CLERK_JWKS_URL + ISSUER
]

app = modal.App(APP_NAME, image=image, secrets=secrets)


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    timeout=60 * 60,
    concurrency_limit=_settings.pipeline_global_concurrency,
)
async def run_pipeline(
    user_id: str, niche_id: str, platform: str, job_id: str | None = None
) -> dict:
    from uuid import UUID
    from marketer.pipeline import run_job
    from marketer.services.otel import force_flush

    try:
        job = await run_job(
            user_id=user_id,
            niche_id=UUID(niche_id),
            platform=platform,
            job_id=UUID(job_id) if job_id else None,
        )
        artifacts.commit()
        return job.model_dump(mode="json")
    finally:
        # Flush the OTEL BatchSpanProcessor so the spans for this pipeline run
        # are exported before the Modal container is reclaimed. Without this,
        # the last ~5 s of buffered spans may be lost on container exit.
        force_flush(timeout_ms=5000)


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    timeout=60 * 10,
)
async def finish_scheduling(user_id: str, job_id: str) -> dict:
    """Resume an operator-approved job at the scheduling stage.

    Spawned by `POST /api/v1/jobs/{id}/approve` — the video is already
    rendered on the artifacts volume; only the Ayrshare upload +
    schedule remain."""
    from uuid import UUID
    from marketer.pipeline import schedule_approved_job
    from marketer.services.otel import force_flush

    try:
        job = await schedule_approved_job(user_id=user_id, job_id=UUID(job_id))
        return job.model_dump(mode="json")
    finally:
        force_flush(timeout_ms=5000)


@app.function(
    volumes={"/assets": assets},
    timeout=60 * 5,
)
async def prewarm_voice_previews() -> dict:
    """Synthesize any missing voice-preview samples so the onboarding
    play button is instant. Run once after deploy:

        modal run modal_app.py::prewarm_voice_previews
    """
    from backend.routes.voices import ALLOWED_VOICES, PREVIEW_LINE, preview_path
    from marketer.services import openai_tts

    created: list[str] = []
    for voice in sorted(ALLOWED_VOICES):
        path = preview_path(voice)
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        await openai_tts.synthesize(PREVIEW_LINE, path, voice=voice)
        created.append(voice)
    assets.commit()
    return {"created": created, "skipped": len(ALLOWED_VOICES) - len(created)}


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    timeout=60 * 60 * 3,  # sequential platforms: up to 3 renders back-to-back
)
async def run_niche_window(user_id: str, niche_id: str, platforms: list[str]) -> list[dict]:
    """Run one niche's posting window: every configured platform,
    sequentially, inside a single container.

    Sequential matters: the per-niche advisory lock means concurrent
    per-platform spawns would race it and mark all but one `skipped` —
    a multi-platform niche would silently post to a single platform
    every window, forever.
    """
    from uuid import UUID
    from marketer.pipeline import run_job
    from marketer.services.otel import force_flush

    results: list[dict] = []
    try:
        for platform in platforms:
            job = await run_job(
                user_id=user_id, niche_id=UUID(niche_id), platform=platform
            )
            results.append(job.model_dump(mode="json"))
        artifacts.commit()
        return results
    finally:
        force_flush(timeout_ms=5000)


@app.function(
    volumes={"/artifacts": artifacts, "/assets": assets},
    schedule=modal.Cron("*/30 * * * *"),  # poll every 30 min; per-niche windows decide
    timeout=60 * 10,
)
async def nightly_batch() -> dict:
    """Walk every user's active niches and spawn one window-run per niche
    whose next posting window falls within the next ~30 min.

    Spawns (fire-and-forget) rather than awaiting: the cron container
    should not sit blocked for the length of the slowest render, and one
    failed pipeline must not poison the batch. An idempotency guard skips
    niches that already have a live job, so an overlapping or delayed
    cron tick can't double-enqueue the same window.
    """
    from datetime import datetime, timedelta, timezone
    from marketer.db import get_pool
    from marketer.repos import jobs as jobs_repo
    from marketer.repos import niches as niches_repo

    pool = await get_pool()
    rows = await pool.fetch("select id from users")
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(minutes=30)

    spawned = 0
    skipped = 0
    for r in rows:
        user_id = r["id"]
        for niche in await niches_repo.list_for_user(user_id):
            # Scan a week of forward windows so we don't silently miss
            # a slot whose tz puts today's instance in the past (or
            # tomorrow's instance closer than today's). The horizon is
            # still 30 min, but we evaluate each window across 0..7 days
            # and let the comparison decide.
            due = any(
                now <= w.at(now + timedelta(days=offset)).astimezone(timezone.utc) < horizon
                for offset in range(0, 8)
                for w in niche.posting_windows
            )
            if not due:
                continue
            if await jobs_repo.has_active_for_niche(niche.id, within_minutes=45):
                skipped += 1
                continue
            run_niche_window.spawn(user_id, str(niche.id), list(niche.platforms))
            spawned += 1
    return {"spawned": spawned, "skipped_active": skipped}


@app.function(
    schedule=modal.Cron("15 * * * *"),  # hourly, offset from other crons
    timeout=60 * 5,
)
async def reap_stale_jobs() -> dict:
    """Fail jobs/articles stuck in a non-terminal status with no progress
    for 2h+ (crashed or timed-out containers strand them there,
    unretryable)."""
    import logging
    from marketer.repos import articles as articles_repo
    from marketer.repos import jobs as jobs_repo

    reaped = await jobs_repo.reap_stale(older_than_minutes=120)
    reaped_articles = await articles_repo.reap_stale(older_than_minutes=120)
    if reaped or reaped_articles:
        logging.getLogger(__name__).error(
            "reaped %d stale job(s) and %d stale article(s) — a container died or timed out mid-run",
            reaped, reaped_articles,
        )
    return {"reaped": reaped, "reaped_articles": reaped_articles}


@app.function(
    volumes={"/artifacts": artifacts},
    timeout=60 * 30,
)
async def run_article_pipeline(
    user_id: str, niche_id: str, article_id: str | None = None, topic: str = ""
) -> dict:
    """One article, end-to-end: research → outline → write → QA →
    metadata/JSON-LD → hero image. The written-content half of the
    platform; spend is metered into the same ledger/caps as video."""
    from uuid import UUID
    from marketer.articles.pipeline import run_article
    from marketer.services.otel import force_flush

    try:
        article = await run_article(
            user_id=user_id,
            niche_id=UUID(niche_id),
            article_id=UUID(article_id) if article_id else None,
            topic=topic,
        )
        artifacts.commit()
        return article.model_dump(mode="json")
    finally:
        force_flush(timeout_ms=5000)


@app.function(
    volumes={"/artifacts": artifacts},
    schedule=modal.Cron("0 9 * * *"),  # 09:00 UTC daily
    timeout=60 * 30,
)
def gc_artifacts() -> dict:
    """Daily GC: delete job artifact dirs older than 30 days.
    DB rows in `jobs` and `spend_ledger` are untouched."""
    from marketer.storage.retention import gc_artifacts as _gc

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


@app.function(
    schedule=modal.Cron("0 11 * * *"),  # 11:00 UTC daily — off-peak relative to 09:00 gc_artifacts
    timeout=60 * 30,
)
async def daily_analytics_sync() -> dict:
    """Pull per-post engagement metrics from Ayrshare for every job in the
    last 14 days that has a provider_post_id.

    Each invocation writes a new post_metrics row — callers can chart the
    time series. One failed fetch never kills the whole sync loop.
    """
    import asyncio
    import logging
    from datetime import datetime, timezone
    from uuid import uuid4

    from marketer.db import get_pool
    from marketer.models import PostMetrics
    from marketer.repos import post_metrics as post_metrics_repo
    from marketer.services.ayrshare_analytics import (
        AyrshareAnalyticsError,
        fetch_post_analytics,
    )

    logger = logging.getLogger(__name__)

    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, user_id, platform, payload->>'provider_post_id' as provider_post_id
          from jobs
         where created_at >= now() - interval '14 days'
           and status in ('done', 'failed')
           and payload->>'provider_post_id' is not null
        """,
    )

    now = datetime.now(timezone.utc)
    ok = 0
    errors = 0

    async def _sync_one(job_id, user_id: str, platform: str, provider_post_id: str) -> None:
        nonlocal ok, errors
        try:
            raw = await fetch_post_analytics(provider_post_id, platforms=[platform])
            # Ayrshare nests analytics per-platform under a top-level
            # "analytics" key.  We try to unpack the relevant sub-dict for
            # the canonical columns; the full raw response is always stored.
            analytics: dict = {}
            if isinstance(raw.get("analytics"), dict):
                # Ayrshare uses the internal platform name as the key
                # (tiktok / instagram / youtube).  Our platform field uses
                # our internal names; try both to be safe.
                from marketer.services.scheduler import PLATFORM_MAP
                ayr_key = PLATFORM_MAP.get(platform, platform)
                analytics = (
                    raw["analytics"].get(ayr_key)
                    or raw["analytics"].get(platform)
                    or {}
                )

            def _int(key: str) -> int | None:
                v = analytics.get(key)
                return int(v) if v is not None else None

            def _dec(key: str):
                from decimal import Decimal
                v = analytics.get(key)
                return Decimal(str(v)) if v is not None else None

            metrics = PostMetrics(
                id=uuid4(),
                user_id=user_id,
                job_id=job_id,
                provider_post_id=provider_post_id,
                platform=platform,
                sampled_at=now,
                views=_int("views") if _int("views") is not None else _int("videoViews"),
                likes=_int("likes"),
                comments=_int("comments"),
                shares=_int("shares"),
                saves=_int("saves") if _int("saves") is not None else _int("saved"),
                watch_time_sec=_dec("totalWatchTime"),
                avg_watch_time_sec=_dec("averageWatchTime"),
                completion_rate=_dec("completionRate"),
                reach=_int("reach"),
                impressions=_int("impressions"),
                raw=raw,
                created_at=now,
            )
            await post_metrics_repo.record(metrics)
            ok += 1
        except AyrshareAnalyticsError as exc:
            logger.warning(
                "analytics fetch failed for job %s provider_post_id=%s: %s",
                job_id, provider_post_id, exc,
            )
            errors += 1
        except Exception:
            logger.exception(
                "unexpected error syncing metrics for job %s provider_post_id=%s",
                job_id, provider_post_id,
            )
            errors += 1

    # Bound the fan-out so a large backlog doesn't hammer Ayrshare's
    # rate limits and turn the whole sync into 429 noise.
    sem = asyncio.Semaphore(5)

    async def _bounded(r) -> None:
        async with sem:
            await _sync_one(r["id"], r["user_id"], r["platform"], r["provider_post_id"])

    await asyncio.gather(*[_bounded(r) for r in rows])

    if errors and not ok:
        # Total failure must be loud (ERROR crosses the Sentry threshold);
        # a warning here means a 100%-failing sync is invisible for weeks.
        logger.error("daily_analytics_sync failed entirely: errors=%d", errors)
    else:
        logger.info("daily_analytics_sync complete: ok=%d errors=%d", ok, errors)
    return {"synced": ok, "errors": errors, "total": len(rows)}


@app.local_entrypoint()
def main(user_id: str, niche_id: str, platform: str = "tiktok"):
    print(run_pipeline.remote(user_id, niche_id, platform))
