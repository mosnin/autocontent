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
from .agents.scriptwriter import should_template_script
from .config import settings
from .logging import get_logger, job_context
from .models import AudioTrack, Clip, Job, JobStatus, Niche, RenderedVideo, Scene, Script
from .orchestrator import (
    qa_payload,
    run_ideation,
    run_qa,
    run_scriptwriter,
    run_visual_director,
)
from .repos import jobs as jobs_repo
from .repos import niches as niches_repo
from .repos import spend as spend_repo
from .services import email as email_svc
from .services import media_archive
from .services import (
    character_sheet,
    elevenlabs_tts,
    ffmpeg,
    grok_imagine,  # noqa: F401 — kept for tests monkeypatching pipeline.grok_imagine
    music,
    music_gen,
    openai_images,
    openai_tts,  # noqa: F401 — kept for tests monkeypatching pipeline.openai_tts
    openai_whisper,
    otel,
    provider_fallback,
    provider_limits,
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


async def _synthesize_vo(
    text: str,
    out_path: Path,
    *,
    niche: Niche,
    spend: SpendContext,
) -> Path:
    """Voiceover through the niche's chosen TTS engine, falling back
    elevenlabs -> openai_tts on a persistent provider failure (see
    services.provider_fallback). openai_tts is the stock engine and has
    no further fallback of its own."""
    return await provider_fallback.synthesize_vo_with_fallback(
        text, out_path, niche=niche, spend=spend,
    )


def _lock_script_facts(script: Script, niche: Niche, extra: str = "") -> Script:
    """Drop invented % / $ / study-year sentences from narration.

    Allowed tokens come from the niche brief plus already-loaded brand /
    knowledge text — videos have no Exa SERP. A one-line scene that
    would empty is left alone (fail-open).
    """
    if extra is None:
        extra = ""
    if not isinstance(extra, str):
        raise TypeError("extra must be a string")
    from .jev.grounding import fact_tokens, strip_ungrounded_claims

    allowed = fact_tokens(
        " ".join(
            part
            for part in (
                niche.title,
                niche.description,
                niche.target_audience,
                extra,
            )
            if part
        )
    )
    notes: list[str] = []
    scenes: list[Scene] = []
    for scene in script.scenes:
        cleaned, stripped = strip_ungrounded_claims(scene.narration or "", allowed)
        notes.extend(stripped)
        if stripped and cleaned.strip():
            scenes.append(scene.model_copy(update={"narration": cleaned}))
        else:
            scenes.append(scene)
    idea = script.idea
    cleaned_hook, hook_notes = strip_ungrounded_claims(idea.hook or "", allowed)
    notes.extend(hook_notes)
    if hook_notes and cleaned_hook.strip():
        idea = idea.model_copy(update={"hook": cleaned_hook})
    if not notes:
        return script
    log.info("script fact lock", extra={"stripped": len(notes)})
    return script.model_copy(update={"scenes": scenes, "idea": idea})


async def _resolve_music(
    *,
    niche: Niche,
    script: Script,
    root: Path,
    resumed: bool,
    spend: SpendContext,
) -> Path | None:
    """Background track. Fail-open except a post-spend cap breach."""
    audio_brief = niche.creative_brief.audio
    if not audio_brief.music_enabled:
        log.info("music disabled by creative brief")
        return None
    music_path: Path | None = None
    want_generated = niche.music_provider == "generated" or (
        niche.music_provider == "auto" and music_gen.enabled()
    )
    if want_generated and music_gen.enabled():
        generated_path = root / "audio" / "music_generated.mp3"
        reuse_music = resumed and generated_path.exists()
        if reuse_music:
            log.info("resume: reusing generated music from prior attempt")
            return generated_path
        try:
            music_path = await music_gen.compose(
                mood=audio_brief.music_mood,
                duration_sec=int(script.total_duration_sec),
                out_path=generated_path,
                niche_title=niche.title,
                spend=spend,
            )
        except spend_repo.SpendCapExceeded as e:
            if getattr(e, "after_spend", False):
                raise
            log.warning(
                "generated music pre-flight spend cap exceeded, "
                "falling back to library: %s",
                e,
            )
        except music_gen.MusicGenError as e:
            log.warning("generated music failed, falling back: %s", e)
    if music_path is None:
        music_path = await music.pick_track(
            query=audio_brief.music_mood or niche.title,
            target_duration_sec=int(script.total_duration_sec),
            library_dir=Path(settings.assets_dir) / "music",
            cache_dir=Path(settings.assets_dir) / "music" / "pixabay",
        )
    return music_path


def _spawn_audio_tasks(
    script: Script,
    *,
    root: Path,
    niche: Niche,
    resumed: bool,
    spend: SpendContext,
    avatar_model: str | None,
    vo_path: Path,
) -> tuple[asyncio.Task, asyncio.Task | None]:
    """Start music (always) and standalone VO (non-avatar) from a locked script."""
    narration = " ".join(s.narration for s in script.scenes)
    music_task = asyncio.create_task(
        _resolve_music(
            niche=niche,
            script=script,
            root=root,
            resumed=resumed,
            spend=spend,
        )
    )
    if avatar_model:
        return music_task, None

    async def _vo_work() -> None:
        if resumed and vo_path.exists():
            log.info("resume: reusing voiceover from prior attempt")
            return
        await _synthesize_vo(narration, vo_path, niche=niche, spend=spend)

    return music_task, asyncio.create_task(_vo_work())


async def _signal_terminal(job: Job, *, kind: str, event: str) -> None:
    """Email + outbound webhook in one beat. Both are fail-open."""
    await asyncio.gather(
        _notify(job, kind=kind),
        _emit_webhook(job, event),
    )


async def _cancel_task(task: asyncio.Task | None) -> None:
    if task is None or task.done():
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001 — teardown
        pass


def _avatar_model_id(niche: Niche) -> str | None:
    """The fal avatar model id when this niche renders lip-synced UGC,
    else None (normal keyframe-animation path)."""
    if niche.video_provider != "fal" or not niche.fal_model:
        return None
    from .services import fal_video

    model = fal_video.get_model(niche.fal_model)
    if model is not None and model.kind == "avatar":
        return model.id
    return None


async def _generate_scene_assets(
    scene: Scene,
    root: Path,
    *,
    niche: Niche,
    reference_image: Path | None,
    spend: SpendContext,
    avatar_model_id: str | None = None,
) -> Clip:
    keyframe = root / "keyframes" / f"scene_{scene.index}.png"
    clip = root / "clips" / f"scene_{scene.index}.mp4"
    async with provider_limits.slot("openai_images"):
        await openai_images.generate_keyframe(
            scene.visual_prompt,
            keyframe,
            quality=niche.image_quality,
            reference_image_path=reference_image,
            spend=spend,
        )
    if avatar_model_id:
        # Lip-synced UGC: this scene's narration is synthesized first and
        # DRIVES the render — the avatar model returns a clip of the cast
        # actually speaking it, audio embedded. Clip length follows the
        # audio, so scene_max_duration_sec doesn't apply here. A failed
        # avatar render falls back to another avatar model (never to a
        # plain i2v model — see services.provider_fallback).
        scene_vo = root / "audio" / f"scene_{scene.index}.wav"
        await _synthesize_vo(scene.narration, scene_vo, niche=niche, spend=spend)
        await provider_fallback.render_avatar_scene(
            keyframe, scene_vo, clip,
            niche=niche,
            avatar_model_id=avatar_model_id,
            spend=spend,
        )
        return Clip(
            scene_index=scene.index,
            keyframe_path=str(keyframe),
            video_path=str(clip),
            duration_sec=ffmpeg.probe_duration(clip),
        )
    clip_duration = min(scene.duration_sec, niche.scene_max_duration_sec)
    # A persistent (non-transient) failure on the niche's chosen i2v
    # provider falls back to a different provider — see
    # services.provider_fallback for the chain policy.
    await provider_fallback.render_i2v_scene(
        keyframe, scene.motion_prompt, clip,
        niche=niche,
        duration_sec=clip_duration,
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


async def _ensure_cap(
    job: Job, niche: Niche, spend: SpendContext | None = None
) -> bool:
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

    # `default_context` already loaded the user. Reuse that snapshot
    # instead of a second users.get on every pre-stage check.
    global_cap = spend.global_cap_usd if spend is not None else None
    if spend is None:
        from .repos import users as users_repo

        user = await users_repo.get(job.user_id)
        if user is not None:
            global_cap = user.global_daily_cap_usd
    if global_cap is not None:
        total = await spend_repo.today_spend_total_usd(user_id=job.user_id)
        if total >= global_cap:
            msg = (
                f"user global daily cap exceeded: "
                f"${total} >= ${global_cap}"
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
    seasoning, never a reason a video can't be made.

    Brand kit and company knowledge are independent reads; one gather.
    """
    try:
        from .company_os.knowledge import prompt_block
        from .repos import brand_kit as brand_kit_repo

        brand, block = await asyncio.gather(
            brand_kit_repo.get(user_id),
            prompt_block(user_id),
            return_exceptions=True,
        )
        voice, banned = "", []
        if not isinstance(brand, BaseException) and brand is not None:
            voice = brand.tone_of_voice or ""
            banned = list(brand.banned_words or [])
        if not isinstance(block, BaseException) and block:
            voice = f"{voice}\n{block}" if voice else block
        return voice, banned
    except Exception:  # noqa: BLE001
        return "", []


async def _spawn_repurpose_article(job: Job, niche: Niche) -> str | None:
    """Create + spawn a Press article from a finished video. Fail-open.

    A missing DB or Modal lookup must never fail the video that already
    passed QA — the hint stays on the job either way.
    """
    topic = ""
    if job.script is not None:
        topic = job.script.idea.topic or job.script.idea.hook
    try:
        from .repos import articles as articles_repo

        article = await articles_repo.create(
            user_id=job.user_id,
            niche_id=niche.id,
            topic=topic,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("jev.repurpose.create_failed", extra={"error": str(exc)})
        return None
    try:
        import modal

        fn = modal.Function.from_name("marketer-sh", "run_article_pipeline")
        fn.spawn(job.user_id, str(niche.id), str(article.id), topic)
    except Exception as exc:  # noqa: BLE001 — row exists; operator can run it
        log.warning("jev.repurpose.spawn_failed", extra={"error": str(exc)})
    return str(article.id)


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
    await _signal_terminal(job, kind="failed", event="job.failed")
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
            job, spend = await asyncio.gather(
                _obtain_job(
                    user_id=user_id, niche_id=niche_id, platform=platform, job_id=job_id
                ),
                default_context(
                    user_id=user_id,
                    niche_id=niche_id,
                    job_id=job_id,
                    cap_usd=niche.daily_spend_cap_usd,
                ),
            )
            if spend is not None:
                spend.job_id = job.id
            root = ensure_layout(f"{user_id}/{job.id}")

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
    if not await _ensure_cap(job, niche, spend):
        return job

    # Fail fast on a misconfigured/rotated ElevenLabs key — BEFORE
    # planner Jev, character-sheet, ideation, or render spend. Without
    # this, a missing key used to pay a planner hop (and used to be
    # checked only after that hop). Left unchanged by provider fallback:
    # this is a deploy-config guard, not a transient provider failure.
    if niche.voice_provider == "elevenlabs" and not elevenlabs_tts.enabled():
        return await _fail_with(
            job,
            "niche voice_provider is 'elevenlabs' but ELEVENLABS_API_KEY is "
            "not configured — fix the niche's voice provider or the API key "
            "before this job can spend anything",
        )

    # Character sheet depends only on the niche look. Start it before
    # planner + ideation so gpt-image-1 hides behind Jev and the setup
    # reads. cast_mode 'none' never builds a sheet.
    sheet_task: asyncio.Task | None = None
    if niche.creative_brief.visual.cast_mode != "none":
        sheet_task = asyncio.create_task(
            character_sheet.get_or_create(
                niche, quality=niche.image_quality, spend=spend
            )
        )

    from .jev.client import warm as jev_warm
    from .jev.planner import plan_video_run

    async def _plan_work():
        try:
            await jev_warm()
        except Exception:  # noqa: BLE001 — prefetch never blocks a job
            pass
        return await plan_video_run(
            {
                "niche": niche.title,
                "platform": platform,
                "description": niche.description,
                "audience": niche.target_audience,
                "script_model": niche.script_model or "",
                "prior_qa_failed": not allow_regenerate,
            },
            script_model=niche.script_model or "",
            spend=spend,
        )

    plan_task = asyncio.create_task(_plan_work())
    try:
        return await _run_job_after_sheet(
            job,
            niche,
            platform,
            root,
            spend,
            sheet_task=sheet_task,
            allow_regenerate=allow_regenerate,
            plan_task=plan_task,
        )
    finally:
        await _cancel_task(sheet_task)
        await _cancel_task(plan_task)


async def _run_job_after_sheet(
    job: Job,
    niche: Niche,
    platform: str,
    root: Path,
    spend: SpendContext,
    *,
    sheet_task: asyncio.Task | None,
    allow_regenerate: bool,
    plan_task: asyncio.Task,
) -> Job:
    from .jev.planner import script_has_caption_source, script_has_usable_visuals

    # Stage resume: a retried job that still carries a script from the
    # failed attempt reuses it (and any per-scene/VO artifacts below)
    # instead of re-spending. Content-rejected retries arrive wiped.
    resumed = job.script is not None
    design_kit_content = ""
    brand_voice = ""
    banned_words: list[str] = []
    avatar_model = _avatar_model_id(niche)
    vo_path = root / "audio" / "voiceover.wav"
    music_task: asyncio.Task | None = None
    vo_task: asyncio.Task | None = None

    if resumed:
        # Brand/knowledge is independent of the planner result. Resume
        # used to re-lock against the niche brief only and strip numbers
        # the writer was already allowed to keep.
        plan, (brand_voice, banned_words) = await asyncio.gather(
            plan_task,
            _load_brand_voice(job.user_id),
        )
        job.harness = {**(job.harness or {}), "plan": plan.as_dict()}
        script: Script = _lock_script_facts(
            job.script, niche, extra=brand_voice
        )
        job.script = script
        log.info("resume: reusing script from prior attempt")
        (root / "script.json").write_text(script.model_dump_json(indent=2))
    else:
        # 1. Ideation — fed the full brief: niche description/audience,
        # brand voice, recent-topic dedupe list, and performance context.
        # Planner Jev overlaps the four setup reads; it does not feed
        # ideation (and must not substitute plan.model_id as script_model).
        with _stage(JobStatus.ideating.value):
            job.status = JobStatus.ideating
            await _persist(job)
            plan, perf_ctx, (brand_voice, banned_words), recent, design_kit_content = (
                await asyncio.gather(
                    plan_task,
                    build_performance_context(
                        niche_id=niche.id,
                        user_id=job.user_id,
                        lookback_days=30,
                    ),
                    _load_brand_voice(job.user_id),
                    jobs_repo.recent_topics_for_niche(
                        niche.id, user_id=job.user_id, limit=20
                    ),
                    _load_design_kit(job.user_id, niche),
                )
            )
            job.harness = {**(job.harness or {}), "plan": plan.as_dict()}
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
            if design_kit_content:
                audience_ctx += (
                    "\nDesign kit — the creator's direction system, follow "
                    f"it throughout:\n{design_kit_content}"
                )
            # Empty niche.script_model is the template path. Do not
            # substitute plan.model_id — that is a writer tier, and it
            # would force a 5–20s LLM on every default job.
            if should_template_script(
                script_model=niche.script_model, brief=niche.creative_brief
            ):
                job.harness = {**(job.harness or {}), "skipped_scriptwriter": True}
            script = await run_scriptwriter(
                idea,
                scene_count=niche.scene_count,
                target_duration_sec=niche.target_duration_sec,
                audience_context=audience_ctx,
                brief=niche.creative_brief,
                script_model=niche.script_model,
                spend=spend,
            )
            # Lock narration before VO and before Visual Director.
            # VD rewrites visuals only; TTS must match the published lines.
            script = _lock_script_facts(script, niche, extra=brand_voice)
            job.script = script
            (root / "script.json").write_text(script.model_dump_json(indent=2))
            # cast_mode 'none' means NO characters — a lingering
            # character_description must not resurrect the cast.
            cast = (
                ""
                if niche.creative_brief.visual.cast_mode == "none"
                else (niche.character_description or "")
            )
            # Scriptwriter already emits visual_prompt + motion_prompt.
            # A second Visual Director LLM pass is the single biggest
            # avoidable latency on a fresh job — skip it when every
            # scene is already usable. When VD does run, VO + music
            # start first so TTS / Pixabay hide behind that hop too.
            if not await _ensure_cap(job, niche, spend):
                return job
            music_task, vo_task = _spawn_audio_tasks(
                script,
                root=root,
                niche=niche,
                resumed=False,
                spend=spend,
                avatar_model=avatar_model,
                vo_path=vo_path,
            )
            if script_has_usable_visuals(script):
                log.info("skip visual director: script already has visual + motion prompts")
                job.harness = {**(job.harness or {}), "skipped_visual_director": True}
            else:
                try:
                    script = await run_visual_director(
                        script,
                        visual_style=niche.visual_style,
                        character_description=cast,
                        brief=niche.creative_brief,
                        design_kit=design_kit_content,
                        spend=spend,
                    )
                except Exception:
                    await _cancel_task(vo_task)
                    await _cancel_task(music_task)
                    raise
                job.script = script
                (root / "script.json").write_text(script.model_dump_json(indent=2))

    # 3. Images + animation (fan-out per scene).
    # VO and music only need the locked script. Fresh jobs already
    # started them before Visual Director; resume starts them here.
    # Avatar mode still synthesizes per-scene VO inside the fan-out.
    if not await _ensure_cap(job, niche, spend):
        await _cancel_task(vo_task)
        await _cancel_task(music_task)
        return job
    if music_task is None:
        music_task, vo_task = _spawn_audio_tasks(
            script,
            root=root,
            niche=niche,
            resumed=resumed,
            spend=spend,
            avatar_model=avatar_model,
            vo_path=vo_path,
        )

    try:
        with _stage(JobStatus.generating_images.value):
            job.status = JobStatus.generating_images
            await _persist(job)
            if sheet_task is not None:
                reference = await sheet_task
            else:
                # Subject-mode video (an object/environment carries the video,
                # not a cast): no character sheet, no reference image — style
                # cohesion is enforced by the visual director's prompts alone.
                reference = None
            # Per-scene resume: clips from the failed attempt whose files are
            # still on the volume are reused; only the missing scenes re-spend.
            # Mode-aware: avatar_model is derived from the CURRENT niche config,
            # which may have changed between attempts (operator switched the
            # fal model from an i2v model to the OmniHuman avatar, or back).
            # Avatar clips carry embedded lip-synced audio; i2v/motion clips
            # never do. In AVATAR mode specifically, reusing a clip with no
            # embedded audio (a stale i2v-mode clip from before the switch)
            # would crash concat(keep_audio=True) on a silent "avatar" clip —
            # so avatar mode verifies audio presence and regenerates on a
            # mismatch (an unprobeable/corrupt clip is treated the same way:
            # regenerate rather than gamble on a broken render). The reverse
            # direction — an avatar-audio clip reused in plain i2v mode — is
            # harmless (concat without keep_audio simply drops the audio
            # track), so plain mode skips the probe and keeps the legacy
            # file-exists-only resume check.
            prior_clips: dict[int, Clip] = {}
            if resumed:
                for c in job.clips:
                    video_path = Path(c.video_path)
                    if not (video_path.exists() and Path(c.keyframe_path).exists()):
                        continue
                    if avatar_model:
                        try:
                            has_audio = ffmpeg.probe_has_audio(video_path)
                        except Exception as e:  # noqa: BLE001 — unprobeable = unreusable
                            log.info(
                                "resume: scene %d clip unprobeable (%s) — regenerating",
                                c.scene_index, e,
                            )
                            continue
                        if not has_audio:
                            log.info(
                                "resume: scene %d clip has no embedded audio in "
                                "avatar mode (stale i2v-mode clip?) — "
                                "regenerating instead of reusing",
                                c.scene_index,
                            )
                            continue
                    prior_clips[c.scene_index] = c
                if prior_clips:
                    log.info(
                        "resume: reusing %d/%d scene clips",
                        len(prior_clips),
                        len(script.scenes),
                    )
            sem = asyncio.Semaphore(settings.scene_fanout_limit)

            async def _bounded(s: Scene) -> Clip:
                cached = prior_clips.get(s.index)
                if cached is not None:
                    return cached
                async with sem:
                    return await _generate_scene_assets(
                        s, root, niche=niche, reference_image=reference, spend=spend,
                        avatar_model_id=avatar_model,
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

        # 4+5. Await the audio tasks started before images. Stage
        # markers stay after the fan-out so resume/UI order is unchanged.
        with _stage(JobStatus.voicing.value):
            job.status = JobStatus.voicing
            await _persist(job)
            if avatar_model:
                # Lip-synced UGC: the voiceover already lives inside each
                # avatar clip (it drove the render). The standalone WAV that
                # captions/QA need is extracted from the assembled video in
                # the edit stage.
                log.info("lip-sync mode: voiceover embedded in avatar clips")
            elif vo_task is not None:
                try:
                    await vo_task
                except spend_repo.SpendCapExceeded as e:
                    await _cancel_task(music_task)
                    try:
                        import sentry_sdk
                        sentry_sdk.capture_exception(e)
                    except Exception:
                        pass
                    return await _fail_with(job, str(e))

        with _stage("music"):
            try:
                music_path = await music_task
            except spend_repo.SpendCapExceeded as e:
                # Post-spend breach from compose — money already moved.
                return await _fail_with(job, str(e))
            except Exception as e:  # noqa: BLE001 — soundtrack never fails a video
                log.warning("music task failed, continuing without: %s", e)
                music_path = None
        job.audio = AudioTrack(
            voiceover_path=str(vo_path),
            music_path=str(music_path) if music_path is not None else None,
        )
    finally:
        await _cancel_task(vo_task)
        await _cancel_task(music_task)

    # 6. Edit (concat + mix)
    with _stage(JobStatus.editing.value):
        job.status = JobStatus.editing
        await _persist(job)
        silent_video = root / "output" / "silent.mp4"
        mixed = root / "output" / "mixed.mp4"
        if avatar_model:
            # Avatar clips carry their own lip-synced voiceover: concat
            # WITH audio, extract the VO track (captions + QA need the
            # standalone WAV), then duck music under the existing audio.
            ffmpeg.concat_clips(
                [Path(c.video_path) for c in job.clips], silent_video,
                aspect=settings.aspect, keep_audio=True,
            )
            ffmpeg.extract_audio(silent_video, vo_path)
            if music_path is not None:
                ffmpeg.mix_music_over(
                    silent_video, music_path, mixed,
                    music_gain_db=job.audio.music_gain_db if job.audio else -18.0,
                )
            else:
                import shutil

                mixed.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(silent_video, mixed)
        else:
            ffmpeg.concat_clips(
                [Path(c.video_path) for c in job.clips], silent_video,
                aspect=settings.aspect,
            )
            ffmpeg.mix_audio(
                silent_video, vo_path, music_path, mixed,
                music_gain_db=job.audio.music_gain_db if job.audio else -18.0,
            )

    # 7. Captions — script timings first (free). Whisper only when the
    # script has no narration to burn. Avatar / lip-sync stretches the
    # words onto the probed mix duration.
    with _stage(JobStatus.captioning.value):
        job.status = JobStatus.captioning
        await _persist(job)
        probed: float | None = None
        try:
            probed = ffmpeg.probe_duration(mixed)
        except Exception:  # noqa: BLE001 — stub files / missing ffprobe
            probed = script.total_duration_sec
        words: list = []
        if script_has_caption_source(script):
            words = subtitle.script_to_words(script.scenes, total_duration_sec=probed)
            job.harness = {**(job.harness or {}), "captions": "script"}
        if not words:
            try:
                words = await openai_whisper.transcribe_word_level(vo_path, spend=spend)
                job.harness = {**(job.harness or {}), "captions": "whisper"}
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
            # Avatar mode's total duration is narration-driven, not a fixed
            # niche target — skip ONLY the duration-drift gate for those
            # jobs so a legitimate lip-sync render isn't rejected (and
            # re-bought on retry) over a target it was never meant to hit.
            # All other gates (streams, silence, VO coverage, size) still
            # run unconditionally for every job.
            enforce_duration=(avatar_model is None),
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
        from .agents.qa import heuristic_qa_report, is_hard_rerender
        from .jev.loops import after_content_qa, repurpose_hint, should_spawn_repurpose

        duration = render_report.duration_sec or script.total_duration_sec
        heuristic = heuristic_qa_report(qa_payload(script, transcript, duration, niche))

        # Duration / empty captions are facts. Do not pay Jev, Foreman,
        # or repurpose to confirm a render the clock already failed.
        if is_hard_rerender(heuristic):
            return await _fail_with(
                job, "content QA failed: " + "; ".join(heuristic.issues)
            )
        # One fan-out: Jev/heuristic QA + Foreman/screen + repurpose.
        # Sequential here used to add a second 70–500ms RTT after a
        # passing judge. Overlay sees the instant heuristic; the gather
        # result is the live Jev report when the key is on.
        report, overlay, hint = await asyncio.gather(
            run_qa(script, transcript, duration, niche=niche, spend=spend),
            after_content_qa(
                {
                    "job_id": str(job.id),
                    "niche": niche.title,
                    "platform": platform,
                    "hook": script.idea.hook,
                    "qa": heuristic.model_dump(),
                    "transcript": transcript[:4000],
                },
                spend=spend,
            ),
            repurpose_hint(
                {
                    "hook": script.idea.hook,
                    "topic": script.idea.topic,
                    "niche": niche.title,
                    "platform": platform,
                },
                spend=spend,
            ),
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
        job.harness = {**(job.harness or {}), **overlay.payload}
        if overlay.fail:
            return await _fail_with(job, overlay.reason)
        if overlay.retry and allow_regenerate:
            log.info("foreman requested regenerate", extra={"reason": overlay.reason})
            _wipe_pipeline_state(job)
            job.status = JobStatus.queued
            await _persist(job)
            return await _run_job_inner(
                job, niche, platform, root, spend, allow_regenerate=False
            )
        if overlay.park:
            job.status = JobStatus.awaiting_approval
            await _persist(job)
            await _signal_terminal(job, kind="review", event="job.awaiting_approval")
            return job
        if hint:
            job.harness = {**(job.harness or {}), "repurpose": hint}
            if should_spawn_repurpose(hint):
                spawned_id = await _spawn_repurpose_article(job, niche)
                if spawned_id:
                    job.harness["repurpose"] = {
                        **hint,
                        "spawned_article_id": spawned_id,
                    }
            await _persist(job)

    # 9. Archive — mirror clips/keyframes/VO/final into the media library
    # (Wasabi when configured, volume-indexed otherwise). Fail-open: a
    # storage hiccup never fails a QA-passed video.
    # 10. Approval gate — the trust ramp. When the niche requires sign-off,
    # a fully rendered + QA-passed video parks here instead of posting.
    # The operator approves via the API, which resumes at the scheduling
    # stage through `schedule_approved_job`.
    if niche.approve_before_post:
        with _stage("archiving"):
            job.status = JobStatus.awaiting_approval
            await asyncio.gather(
                _persist(job),
                media_archive.archive_job_media(job, niche),
                _signal_terminal(job, kind="review", event="job.awaiting_approval"),
            )
        log.info("awaiting approval", extra={"job_id": str(job.id)})
        return job

    # 11. Schedule via Ayrshare (per-user profile). Archive overlaps
    # Auto Mode so Wasabi/volume I/O does not sit in front of Jev.
    return await _schedule_stage(job, niche, archive=True)


async def _schedule_stage(
    job: Job,
    niche: Niche,
    *,
    human_approved: bool = False,
    archive: bool = False,
) -> Job:
    """Upload + schedule the rendered video, then mark the job done.

    Shared by the autonomous path (straight after QA) and the approval
    path (resumed via `schedule_approved_job`)."""
    assert job.rendered is not None and job.script is not None
    from .jev.loops import publish_gate

    gate_coro = publish_gate(
        {
            "job_id": str(job.id),
            "niche": niche.title,
            "platform": job.platform,
            "hook": job.script.idea.hook,
            "caption": job.script.idea.hook,
            "hashtags": niche.hashtags,
        },
        tool="schedule_post",
        human_approved=human_approved,
    )
    if archive:
        with _stage("archiving"):
            gate, _ = await asyncio.gather(
                gate_coro,
                media_archive.archive_job_media(job, niche),
            )
    else:
        gate = await gate_coro
    job.harness = {**(job.harness or {}), **gate.payload}
    if gate.fail:
        return await _fail_with(job, gate.reason or "jev auto-mode blocked publish")
    if gate.park:
        job.status = JobStatus.awaiting_approval
        await _persist(job)
        await _signal_terminal(job, kind="review", event="job.awaiting_approval")
        return job
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
    await _signal_terminal(job, kind="scheduled", event="job.done")
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
            return await _schedule_stage(job, niche, human_approved=True)
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
