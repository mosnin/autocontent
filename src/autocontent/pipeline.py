"""End-to-end pipeline entrypoint.

`run_job(user_id, niche_id, platform)` walks a Job from queued → done.
Each stage persists the Job back to Postgres so Modal can resume on
failure. Per-scene image + animation fan-out is parallelized via asyncio.

Spend cap is enforced in two places:
- a cheap pre-stage `_ensure_cap` check (DB read) is the early-out,
- `SpendContext.log` re-checks after every recorded spend and raises
  `SpendCapExceeded` — that's the actual race-safe guarantee, the
  pre-stage check can be raced past by N parallel fan-out tasks.

Every stage emits `stage.start` and `stage.end` JSON log lines tagged
with `job_id`, `user_id`, `niche_id`, `stage`, and `latency_ms`.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator
from uuid import UUID

from opentelemetry import trace

from .agents.performance_context import build_performance_context
from .config import settings
from .logging import get_logger, job_context
from .models import AudioTrack, Clip, Job, JobStatus, Niche, RenderedVideo, Scene, Script
from .orchestrator import run_ideation, run_qa, run_scriptwriter, run_visual_director
from .repos import jobs as jobs_repo
from .repos import niches as niches_repo
from .repos import spend as spend_repo
from .services import email as email_svc
from .services import (
    character_sheet,
    ffmpeg,
    grok_imagine,
    music,
    openai_images,
    openai_tts,
    openai_whisper,
    otel,
    scheduler,
    subtitle,
)
from .services.concurrency import niche_lock, user_lock
from .services.spend_context import SpendContext, default_context
from .storage.volume import ensure_layout

log = get_logger(__name__)


@contextmanager
def _stage(name: str) -> Iterator[None]:
    """Emit stage.start / stage.end log lines around a block.

    Also creates an OTEL span named ``pipeline.stage.<name>`` so the
    per-stage latency is visible in any connected APM (Honeycomb, Axiom,
    Datadog, Tempo…). The log lines are preserved for backward compat.
    """
    tracer = otel.get_tracer(__name__)
    with tracer.start_as_current_span(f"pipeline.stage.{name}") as span:
        span.set_attribute("autocontent.stage", name)
        log.info("stage.start", extra={"stage": name})
        started = time.monotonic()
        try:
            yield
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(trace.StatusCode.ERROR, str(exc))
            raise
        finally:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            log.info("stage.end", extra={"stage": name, "latency_ms": elapsed_ms})


async def _generate_scene_assets(
    scene: Scene,
    root: Path,
    *,
    niche: Niche,
    reference_image: Path,
    spend: SpendContext,
) -> Clip:
    keyframe = root / "keyframes" / f"scene_{scene.index}.png"
    clip = root / "clips" / f"scene_{scene.index}.mp4"
    await openai_images.generate_keyframe(
        scene.visual_prompt,
        keyframe,
        quality=niche.image_quality,
        reference_image_path=reference_image,
        spend=spend,
    )
    clip_duration = min(scene.duration_sec, niche.scene_max_duration_sec)
    await grok_imagine.animate(
        keyframe, scene.motion_prompt, clip,
        duration_sec=clip_duration,
        resolution=niche.video_resolution,
        spend=spend,
    )
    return Clip(
        scene_index=scene.index,
        keyframe_path=str(keyframe),
        video_path=str(clip),
        duration_sec=clip_duration,
    )


async def _persist(job: Job) -> None:
    await jobs_repo.save_snapshot(job)


async def _ensure_cap(job: Job, niche: Niche) -> bool:
    try:
        await spend_repo.assert_within_cap(
            user_id=job.user_id,
            niche_id=niche.id,
            cap_usd=niche.daily_spend_cap_usd,
        )
    except spend_repo.SpendCapExceeded as e:
        job.status = JobStatus.failed
        job.error = str(e)
        await _persist(job)
        return False

    # Global cap check — read user record to get global_daily_cap_usd.
    from .repos import users as users_repo

    user = await users_repo.get(job.user_id)
    if user is not None and user.global_daily_cap_usd is not None:
        total = await spend_repo.today_spend_total_usd(user_id=job.user_id)
        if total >= user.global_daily_cap_usd:
            msg = (
                f"user global daily cap exceeded: "
                f"${total} >= ${user.global_daily_cap_usd}"
            )
            job.status = JobStatus.failed
            job.error = msg
            await _persist(job)
            return False

    return True


async def _notify(job: Job, *, kind: str) -> None:
    """Email the operator at a terminal moment. Fail-open: notification
    problems never affect job state."""
    try:
        from .repos import users as users_repo

        user = await users_repo.get(job.user_id)
        if user is None or not user.email:
            return
        hook = job.script.idea.hook if job.script else None
        if kind == "review":
            subject, html = email_svc.render_ready_for_review(str(job.id), hook)
        else:
            subject, html = email_svc.render_video_scheduled(str(job.id), hook)
        await email_svc.send_email(to=user.email, subject=subject, html=html)
    except Exception as e:  # noqa: BLE001 — never let email break a job
        log.warning("notification failed", extra={"error": str(e)})


async def _fail_with(job: Job, error: str) -> Job:
    job.status = JobStatus.failed
    job.error = error
    await _persist(job)
    try:
        import sentry_sdk
        sentry_sdk.capture_exception()
    except Exception:  # sentry not installed or not initialised — never block the pipeline
        pass
    return job


async def run_job(*, user_id: str, niche_id: UUID, platform: str) -> Job:
    niche = await niches_repo.get(niche_id, user_id=user_id)
    if niche is None:
        raise ValueError(f"niche {niche_id} not found for user {user_id}")
    if platform not in niche.platforms:
        raise ValueError(f"platform {platform} not enabled for niche {niche_id}")

    async with niche_lock(niche_id) as got_niche:
        if not got_niche:
            # Another container is already working this niche — create a
            # visible job row so users can see the skip in the queue UI,
            # then return immediately without touching any provider.
            job = await jobs_repo.create(
                user_id=user_id, niche_id=niche_id, platform=platform
            )
            job.status = JobStatus.skipped
            job.error = "niche already running in another job"
            await jobs_repo.save_snapshot(job)
            log.info(
                "skip: niche already running",
                extra={"niche_id": str(niche_id)},
            )
            return job

        async with user_lock(
            user_id, max_parallel=settings.pipeline_per_user_concurrency
        ):
            job = await jobs_repo.create(
                user_id=user_id, niche_id=niche_id, platform=platform
            )
            root = ensure_layout(f"{user_id}/{job.id}")
            spend = await default_context(
                user_id=user_id,
                niche_id=niche_id,
                job_id=job.id,
                cap_usd=niche.daily_spend_cap_usd,
            )

            tracer = otel.get_tracer(__name__)
            with tracer.start_as_current_span("pipeline.run_job") as span:
                span.set_attribute("autocontent.user_id", user_id)
                span.set_attribute("autocontent.niche_id", str(niche_id))
                span.set_attribute("autocontent.platform", platform)
                span.set_attribute("autocontent.job_id", str(job.id))
                with job_context(job_id=job.id, user_id=user_id, niche_id=niche_id):
                    try:
                        result = await _run_job_inner(job, niche, platform, root, spend)
                    except Exception as exc:
                        span.record_exception(exc)
                        span.set_status(trace.StatusCode.ERROR, str(exc))
                        raise
                    span.set_attribute("autocontent.job_status", result.status.value)
                    return result


async def _run_job_inner(
    job: Job,
    niche: Niche,
    platform: str,
    root: Path,
    spend: SpendContext,
) -> Job:
    if not await _ensure_cap(job, niche):
        return job

    # 1. Ideation
    with _stage(JobStatus.ideating.value):
        job.status = JobStatus.ideating
        await _persist(job)
        perf_ctx = await build_performance_context(
            niche_id=niche.id,
            user_id=job.user_id,
            lookback_days=30,
        )
        idea = await run_ideation(niche.title, performance_context=perf_ctx)

    # 2. Script + visual direction
    with _stage(JobStatus.scripting.value):
        job.status = JobStatus.scripting
        await _persist(job)
        script: Script = await run_scriptwriter(
            idea,
            scene_count=niche.scene_count,
            target_duration_sec=niche.target_duration_sec,
        )
        script = await run_visual_director(script, visual_style=niche.visual_style)
        job.script = script
        (root / "script.json").write_text(script.model_dump_json(indent=2))

    # 3. Images + animation (fan-out per scene)
    if not await _ensure_cap(job, niche):
        return job
    with _stage(JobStatus.generating_images.value):
        job.status = JobStatus.generating_images
        await _persist(job)
        reference = await character_sheet.get_or_create(
            niche, quality=niche.image_quality, spend=spend
        )
        try:
            sem = asyncio.Semaphore(settings.scene_fanout_limit)

            async def _bounded(s: Scene) -> Clip:
                async with sem:
                    return await _generate_scene_assets(
                        s, root, niche=niche, reference_image=reference, spend=spend,
                    )

            job.clips = list(await asyncio.gather(
                *[_bounded(s) for s in script.scenes]
            ))
        except spend_repo.SpendCapExceeded as _exc:
            try:
                import sentry_sdk
                sentry_sdk.capture_exception(_exc)
            except Exception:
                pass
            return await _fail_with(job, "spend_cap_exceeded during fan-out")
    with _stage(JobStatus.animating.value):
        job.status = JobStatus.animating
        await _persist(job)

    # 4. Voiceover
    if not await _ensure_cap(job, niche):
        return job
    with _stage(JobStatus.voicing.value):
        job.status = JobStatus.voicing
        await _persist(job)
        vo_path = root / "audio" / "voiceover.wav"
        narration = " ".join(s.narration for s in script.scenes)
        try:
            await openai_tts.synthesize(
                narration, vo_path,
                voice=niche.voice,
                style_directions=niche.tts_style_directions,
                spend=spend,
            )
        except spend_repo.SpendCapExceeded as e:
            try:
                import sentry_sdk
                sentry_sdk.capture_exception(e)
            except Exception:
                pass
            return await _fail_with(job, str(e))

    # 5. Music
    # Derive a search query from existing Niche fields — no schema change needed.
    # `niche.title` (e.g. "claymation econ explainers") + `niche.visual_style`
    # (e.g. "claymation, warm palette") give Pixabay enough signal to find
    # thematically appropriate background music. We take just the title to keep
    # the query short and searchable; visual_style tends to be image-specific.
    music_query = niche.title
    music_path = await music.pick_track(
        query=music_query,
        target_duration_sec=int(script.total_duration_sec),
        library_dir=Path(settings.assets_dir) / "music",
        cache_dir=Path(settings.assets_dir) / "music" / "pixabay",
    )
    job.audio = AudioTrack(
        voiceover_path=str(vo_path),
        music_path=str(music_path) if music_path is not None else None,
    )

    # 6. Edit (concat + mix)
    with _stage(JobStatus.editing.value):
        job.status = JobStatus.editing
        await _persist(job)
        silent_video = root / "output" / "silent.mp4"
        ffmpeg.concat_clips(
            [Path(c.video_path) for c in job.clips], silent_video, aspect=settings.aspect
        )
        mixed = root / "output" / "mixed.mp4"
        ffmpeg.mix_audio(
            silent_video, vo_path, music_path, mixed,
            music_gain_db=job.audio.music_gain_db if job.audio else -18.0,
        )

    # 7. Captions
    with _stage(JobStatus.captioning.value):
        job.status = JobStatus.captioning
        await _persist(job)
        try:
            words = await openai_whisper.transcribe_word_level(vo_path, spend=spend)
        except spend_repo.SpendCapExceeded as e:
            try:
                import sentry_sdk
                sentry_sdk.capture_exception(e)
            except Exception:
                pass
            return await _fail_with(job, str(e))
        ass_path = root / "captions" / "subs.ass"
        subtitle.words_to_ass(words, ass_path)
        final = root / "output" / "final.mp4"
        ffmpeg.burn_subtitles(mixed, ass_path, final)
        job.rendered = RenderedVideo(
            path=str(final),
            duration_sec=script.total_duration_sec,
            captions_path=str(ass_path),
        )

    # 8. QA (strict — only path to scheduling)
    with _stage(JobStatus.qa.value):
        job.status = JobStatus.qa
        await _persist(job)
        transcript = " ".join(w["word"] for w in words)
        report = await run_qa(script, transcript, script.total_duration_sec, niche=niche)
        if not report.passed:
            return await _fail_with(job, "; ".join(report.issues))

    # 9. Approval gate — the trust ramp. When the niche requires sign-off,
    # a fully rendered + QA-passed video parks here instead of posting.
    # The operator approves via the API, which resumes at the scheduling
    # stage through `schedule_approved_job`.
    if niche.approve_before_post:
        job.status = JobStatus.awaiting_approval
        await _persist(job)
        log.info("awaiting approval", extra={"job_id": str(job.id)})
        await _notify(job, kind="review")
        return job

    # 10. Schedule via Ayrshare (per-user profile)
    return await _schedule_stage(job, niche)


async def _schedule_stage(job: Job, niche: Niche) -> Job:
    """Upload + schedule the rendered video, then mark the job done.

    Shared by the autonomous path (straight after QA) and the approval
    path (resumed via `schedule_approved_job`)."""
    assert job.rendered is not None and job.script is not None
    with _stage(JobStatus.scheduling.value):
        job.status = JobStatus.scheduling
        await _persist(job)
        when = _next_posting_slot(niche)
        post_id = await scheduler.schedule_post(
            video_path=Path(job.rendered.path),
            caption=job.script.idea.hook,
            hashtags=niche.hashtags,
            platform=job.platform,
            scheduled_for=when,
            profile_key=None,  # resolved inside scheduler from user_id
            user_id=job.user_id,
        )
        job.scheduled_for = when
        job.provider_post_id = post_id
        job.status = JobStatus.done
        await _persist(job)
    await _notify(job, kind="scheduled")
    return job


async def schedule_approved_job(*, user_id: str, job_id: UUID) -> Job:
    """Resume an `awaiting_approval` job at the scheduling stage.

    Invoked from the Modal `finish_scheduling` function after the
    operator approves via `POST /api/v1/jobs/{id}/approve`."""
    job = await jobs_repo.get(job_id, user_id=user_id)
    if job is None:
        raise ValueError(f"job {job_id} not found for user {user_id}")
    if job.status != JobStatus.awaiting_approval:
        raise ValueError(f"job {job_id} is {job.status}, not awaiting_approval")
    niche = await niches_repo.get(job.niche_id, user_id=user_id)
    if niche is None:
        raise ValueError(f"niche {job.niche_id} not found for user {user_id}")

    with job_context(job_id=job.id, user_id=user_id, niche_id=job.niche_id):
        try:
            return await _schedule_stage(job, niche)
        except Exception as e:
            return await _fail_with(job, f"scheduling failed after approval: {e}")


def _next_posting_slot(niche: Niche) -> datetime:
    """Pick the soonest future posting window for this niche.

    Scans a week's worth of forward windows so we never silently miss a
    slot when the window's tz puts today's instance in the past. Raises
    `ValueError` if the niche has no configured windows."""
    if not niche.posting_windows:
        raise ValueError("niche has no posting windows")
    now = datetime.now(timezone.utc)
    grace = now + timedelta(minutes=1)
    candidates: list[datetime] = []
    for offset in range(0, 8):
        day = now + timedelta(days=offset)
        for w in niche.posting_windows:
            candidates.append(w.at(day).astimezone(timezone.utc))
    future = [c for c in candidates if c > grace]
    if not future:
        # Pathological case: only possible if .at() returns dates in the
        # past for all 8 forward days (e.g. clock skew). Raise rather
        # than silently scheduling in the past.
        raise ValueError("niche posting windows produced no future slots")
    return min(future)
