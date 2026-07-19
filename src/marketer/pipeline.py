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
from .services import media_archive
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
    video_qa,
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
        span.set_attribute("marketer.stage", name)
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
    reference_image: Path | None,
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
    if niche.video_provider == "fal" and niche.fal_model:
        from .services import fal_video

        await fal_video.animate(
            keyframe, scene.motion_prompt, clip,
            model_id=niche.fal_model,
            duration_sec=clip_duration,
            spend=spend,
        )
    else:
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


async def _load_design_kit(user_id: str, niche: Niche) -> str:
    """The design kit content that applies to this niche (pinned kit, else
    the user's default design kit). Fail-open: kits season, never block."""
    try:
        from .repos import kits as kits_repo

        kit = await kits_repo.resolve(
            user_id=user_id, kind="design", kit_id=niche.design_kit_id
        )
        return kit.content if kit is not None else ""
    except Exception:  # noqa: BLE001
        return ""


async def _load_brand_voice(user_id: str) -> tuple[str, list[str]]:
    """Account brand kit → (voice, banned words). Fail-open: brand kit is
    seasoning, never a reason a video can't be made."""
    try:
        from .repos import brand_kit as brand_kit_repo

        brand = await brand_kit_repo.get(user_id)
        if brand is None:
            return "", []
        return brand.tone_of_voice or "", list(brand.banned_words or [])
    except Exception:  # noqa: BLE001
        return "", []


async def _notify(job: Job, *, kind: str) -> None:
    """Email the operator at a terminal moment. Fail-open: notification
    problems never affect job state. Skips silently when the user has opted
    out of email notifications."""
    try:
        from .repos import users as users_repo

        user = await users_repo.get(job.user_id)
        if user is None or not user.email or not user.email_notifications:
            return
        hook = job.script.idea.hook if job.script else None
        if kind == "review":
            subject, html = email_svc.render_ready_for_review(str(job.id), hook)
        elif kind == "failed":
            subject, html = email_svc.render_video_failed(str(job.id), hook)
        else:
            subject, html = email_svc.render_video_scheduled(str(job.id), hook)
        await email_svc.send_email(to=user.email, subject=subject, html=html)
    except Exception as e:  # noqa: BLE001 — never let email break a job
        log.warning("notification failed", extra={"error": str(e)})


async def _emit_webhook(job: Job, event: str) -> None:
    """Fire an outbound webhook for a job terminal state. Fail-open."""
    try:
        import time as _time

        from .services import webhook_delivery

        await webhook_delivery.emit(
            job.user_id, event,
            {
                "job_id": str(job.id),
                "niche_id": str(job.niche_id),
                "platform": job.platform,
                "status": job.status.value,
                "scheduled_for": job.scheduled_for.isoformat() if job.scheduled_for else None,
                "provider_post_id": job.provider_post_id,
                "error": job.error,
            },
            timestamp=int(_time.time()),
        )
    except Exception as e:  # noqa: BLE001 — never let a webhook break a job
        log.warning("webhook emit failed", extra={"error": str(e)})


async def _fail_with(job: Job, error: str, exc: BaseException | None = None) -> Job:
    job.status = JobStatus.failed
    job.error = error
    await _persist(job)
    await _notify(job, kind="failed")
    await _emit_webhook(job, "job.failed")
    try:
        import sentry_sdk
        if exc is not None:
            sentry_sdk.capture_exception(exc)
        else:
            sentry_sdk.capture_message(f"job {job.id} failed: {error}", level="error")
    except Exception:  # sentry not installed or not initialised — never block the pipeline
        pass
    return job


# Shared with repos.jobs — the retry route resets `error` before this
# module ever sees the row, so the authoritative wipe-on-content-rejection
# lives in jobs_repo.reset_for_retry; these aliases keep in-run paths
# (auto-regenerate, direct invocations) on the same definitions.
_CONTENT_REJECTION_PREFIXES = jobs_repo.CONTENT_REJECTION_PREFIXES
_wipe_pipeline_state = jobs_repo.wipe_pipeline_state


async def _obtain_job(
    *, user_id: str, niche_id: UUID, platform: str, job_id: UUID | None
) -> Job:
    """Reuse the caller's job row when one was already created (enqueue /
    retry pass it through), else create one. Reusing keeps the id the API
    handed to the client as the id that actually progresses — previously
    the pipeline always created a second row and the first sat `queued`
    forever.

    Retries RESUME rather than restart: persisted script/clips survive so
    a transient failure at (say) captioning doesn't re-buy ideation, six
    images, six animations, and TTS. The only exception is a QA content
    rejection — there the artifacts *are* the problem, so they're wiped."""
    if job_id is not None:
        job = await jobs_repo.get(job_id, user_id=user_id)
        if job is not None:
            if job.error and job.error.startswith(_CONTENT_REJECTION_PREFIXES):
                _wipe_pipeline_state(job)
            job.status = JobStatus.queued
            job.error = None
            job.rendered = None
            job.scheduled_for = None
            job.provider_post_id = None
            await _persist(job)
            return job
        log.warning("job %s not found for reuse; creating fresh row", job_id)
    return await jobs_repo.create(user_id=user_id, niche_id=niche_id, platform=platform)


async def run_job(
    *, user_id: str, niche_id: UUID, platform: str, job_id: UUID | None = None
) -> Job:
    niche = await niches_repo.get(niche_id, user_id=user_id)
    if niche is None:
        raise ValueError(f"niche {niche_id} not found for user {user_id}")
    if platform not in niche.platforms:
        raise ValueError(f"platform {platform} not enabled for niche {niche_id}")

    async with niche_lock(niche_id) as got_niche:
        if not got_niche:
            # Another container is already working this niche — mark the
            # job skipped (visibly, in the queue UI) without touching any
            # provider.
            job = await _obtain_job(
                user_id=user_id, niche_id=niche_id, platform=platform, job_id=job_id
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
            job = await _obtain_job(
                user_id=user_id, niche_id=niche_id, platform=platform, job_id=job_id
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
                span.set_attribute("marketer.user_id", user_id)
                span.set_attribute("marketer.niche_id", str(niche_id))
                span.set_attribute("marketer.platform", platform)
                span.set_attribute("marketer.job_id", str(job.id))
                with job_context(job_id=job.id, user_id=user_id, niche_id=niche_id):
                    try:
                        result = await _run_job_inner(job, niche, platform, root, spend)
                    except Exception as exc:
                        # Terminal backstop: without this, any unhandled
                        # provider/ffmpeg/LLM failure strands the row in a
                        # non-terminal status forever (unretryable zombie).
                        span.record_exception(exc)
                        span.set_status(trace.StatusCode.ERROR, str(exc))
                        return await _fail_with(
                            job, f"{type(exc).__name__}: {exc}", exc
                        )
                    span.set_attribute("marketer.job_status", result.status.value)
                    return result


async def _run_job_inner(
    job: Job,
    niche: Niche,
    platform: str,
    root: Path,
    spend: SpendContext,
    *,
    allow_regenerate: bool = True,
) -> Job:
    if not await _ensure_cap(job, niche):
        return job

    # Stage resume: a retried job that still carries a script from the
    # failed attempt reuses it (and any per-scene/VO artifacts below)
    # instead of re-spending. Content-rejected retries arrive wiped.
    resumed = job.script is not None

    if resumed:
        script: Script = job.script
        log.info("resume: reusing script from prior attempt")
        (root / "script.json").write_text(script.model_dump_json(indent=2))
    else:
        # 1. Ideation — fed the full brief: niche description/audience,
        # brand voice, recent-topic dedupe list, and performance context.
        with _stage(JobStatus.ideating.value):
            job.status = JobStatus.ideating
            await _persist(job)
            perf_ctx = await build_performance_context(
                niche_id=niche.id,
                user_id=job.user_id,
                lookback_days=30,
            )
            brand_voice, banned_words = await _load_brand_voice(job.user_id)
            recent = await jobs_repo.recent_topics_for_niche(
                niche.id, user_id=job.user_id, limit=20
            )
            idea = await run_ideation(
                niche.title,
                performance_context=perf_ctx,
                niche_description=niche.description,
                target_audience=niche.target_audience,
                platform=platform,
                brand_voice=brand_voice,
                banned_words=banned_words,
                recent_topics=recent,
                brief=niche.creative_brief,
                spend=spend,
            )

        # 2. Script + visual direction
        with _stage(JobStatus.scripting.value):
            job.status = JobStatus.scripting
            await _persist(job)
            audience_ctx = f"Audience: {niche.target_audience}. Platform: {platform}."
            if brand_voice:
                audience_ctx += f" Brand voice: {brand_voice}."
            design_kit_content = await _load_design_kit(job.user_id, niche)
            if design_kit_content:
                audience_ctx += (
                    "\nDesign kit — the creator's direction system, follow "
                    f"it throughout:\n{design_kit_content}"
                )
            script = await run_scriptwriter(
                idea,
                scene_count=niche.scene_count,
                target_duration_sec=niche.target_duration_sec,
                audience_context=audience_ctx,
                brief=niche.creative_brief,
                script_model=niche.script_model,
                spend=spend,
            )
            script = await run_visual_director(
                script,
                visual_style=niche.visual_style,
                character_description=niche.character_description or "",
                brief=niche.creative_brief,
                design_kit=design_kit_content,
                spend=spend,
            )
            job.script = script
            (root / "script.json").write_text(script.model_dump_json(indent=2))

    # 3. Images + animation (fan-out per scene)
    if not await _ensure_cap(job, niche):
        return job
    with _stage(JobStatus.generating_images.value):
        job.status = JobStatus.generating_images
        await _persist(job)
        if niche.creative_brief.visual.cast_mode == "none":
            # Subject-mode video (an object/environment carries the video,
            # not a cast): no character sheet, no reference image — style
            # cohesion is enforced by the visual director's prompts alone.
            reference = None
        else:
            reference = await character_sheet.get_or_create(
                niche, quality=niche.image_quality, spend=spend
            )
        # Per-scene resume: clips from the failed attempt whose files are
        # still on the volume are reused; only the missing scenes re-spend.
        prior_clips: dict[int, Clip] = {}
        if resumed:
            prior_clips = {
                c.scene_index: c
                for c in job.clips
                if Path(c.video_path).exists() and Path(c.keyframe_path).exists()
            }
            if prior_clips:
                log.info(
                    "resume: reusing %d/%d scene clips", len(prior_clips), len(script.scenes)
                )
        sem = asyncio.Semaphore(settings.scene_fanout_limit)

        async def _bounded(s: Scene) -> Clip:
            cached = prior_clips.get(s.index)
            if cached is not None:
                return cached
            async with sem:
                return await _generate_scene_assets(
                    s, root, niche=niche, reference_image=reference, spend=spend,
                )

        # return_exceptions so completed clips are persisted even when a
        # sibling scene fails — a retry then resumes per-scene instead of
        # re-buying every image/animation that already succeeded.
        results = await asyncio.gather(
            *[_bounded(s) for s in script.scenes], return_exceptions=True
        )
        completed = {r.scene_index: r for r in results if isinstance(r, Clip)}
        job.clips = [completed[s.index] for s in script.scenes if s.index in completed]
        errors = [r for r in results if isinstance(r, BaseException)]
        if errors:
            await _persist(job)  # keep the paid clips for per-scene resume
            exc = next(
                (e for e in errors if isinstance(e, spend_repo.SpendCapExceeded)),
                errors[0],
            )
            try:
                import sentry_sdk
                sentry_sdk.capture_exception(exc)
            except Exception:
                pass
            if isinstance(exc, spend_repo.SpendCapExceeded):
                return await _fail_with(job, "spend_cap_exceeded during fan-out")
            raise exc  # terminal backstop persists the failure
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
        # Same script as the failed attempt means the VO on the volume is
        # still the right narration — skip the re-synth.
        reuse_vo = resumed and vo_path.exists()
        if reuse_vo:
            log.info("resume: reusing voiceover from prior attempt")
        try:
            if not reuse_vo:
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
    audio_brief = niche.creative_brief.audio
    with _stage("music"):
        if not audio_brief.music_enabled:
            log.info("music disabled by creative brief")
            music_path = None
        else:
            music_path = await music.pick_track(
                query=audio_brief.music_mood or niche.title,
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
        subtitle.words_to_ass(
            words, ass_path, caption_style=niche.creative_brief.audio.caption_style
        )
        final = root / "output" / "final.mp4"
        ffmpeg.burn_subtitles(mixed, ass_path, final)

    # 8. QA (strict — only path to scheduling).
    # Two gates: a deterministic ffprobe pass on the actual rendered file
    # (duration covers VO, streams present, not silent, fits the upload
    # limit — re-encoding when it doesn't), then the LLM content pass.
    with _stage(JobStatus.qa.value):
        job.status = JobStatus.qa
        await _persist(job)
        render_report = video_qa.check_render(
            final,
            voiceover_path=vo_path,
            target_duration_sec=niche.target_duration_sec,
        )
        # Record what was actually rendered (real probed duration, and the
        # re-encoded file when the original blew the upload budget).
        job.rendered = RenderedVideo(
            path=render_report.final_path,
            duration_sec=render_report.duration_sec or script.total_duration_sec,
            captions_path=str(ass_path),
        )
        await _persist(job)
        if not render_report.passed:
            return await _fail_with(
                job, "render QA failed: " + "; ".join(render_report.issues)
            )
        transcript = " ".join(w["word"] for w in words)
        report = await run_qa(
            script,
            transcript,
            # Judge the real rendered duration, not the script's claim.
            render_report.duration_sec or script.total_duration_sec,
            niche=niche,
            spend=spend,
        )
        if not report.passed:
            # One bounded in-run regenerate when QA says the *script* is
            # the problem — a fresh script usually passes, and failing the
            # job here wastes everything already rendered well. Spend caps
            # still gate every call in the second attempt.
            if allow_regenerate and report.suggested_action == "regenerate_script":
                log.info(
                    "qa rejected script; auto-regenerating once",
                    extra={"issues": "; ".join(report.issues)},
                )
                _wipe_pipeline_state(job)
                job.status = JobStatus.queued
                await _persist(job)
                return await _run_job_inner(
                    job, niche, platform, root, spend, allow_regenerate=False
                )
            # Prefix matters: _obtain_job wipes state on retry for content
            # rejections so the same script isn't re-judged to death.
            return await _fail_with(
                job, "content QA failed: " + "; ".join(report.issues)
            )

    # 9. Archive — mirror clips/keyframes/VO/final into the media library
    # (Wasabi when configured, volume-indexed otherwise). Fail-open: a
    # storage hiccup never fails a QA-passed video.
    with _stage("archiving"):
        await media_archive.archive_job_media(job, niche)

    # 10. Approval gate — the trust ramp. When the niche requires sign-off,
    # a fully rendered + QA-passed video parks here instead of posting.
    # The operator approves via the API, which resumes at the scheduling
    # stage through `schedule_approved_job`.
    if niche.approve_before_post:
        job.status = JobStatus.awaiting_approval
        await _persist(job)
        log.info("awaiting approval", extra={"job_id": str(job.id)})
        await _notify(job, kind="review")
        await _emit_webhook(job, "job.awaiting_approval")
        return job

    # 11. Schedule via Ayrshare (per-user profile)
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
    await _emit_webhook(job, "job.done")
    return job


async def schedule_approved_job(*, user_id: str, job_id: UUID) -> Job:
    """Resume an `awaiting_approval` job at the scheduling stage.

    Invoked from the Modal `finish_scheduling` function after the
    operator approves via `POST /api/v1/jobs/{id}/approve`."""
    job = await jobs_repo.get(job_id, user_id=user_id)
    if job is None:
        raise ValueError(f"job {job_id} not found for user {user_id}")
    # The approve endpoint atomically claims the row into `scheduling`
    # before spawning us; accept awaiting_approval too for direct
    # invocation (modal run / tests).
    if job.status not in (JobStatus.awaiting_approval, JobStatus.scheduling):
        raise ValueError(f"job {job_id} is {job.status}, not awaiting_approval")
    if job.provider_post_id:
        raise ValueError(f"job {job_id} already has a scheduled post")
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
