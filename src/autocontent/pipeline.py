"""End-to-end pipeline entrypoint.

`run_job(user_id, niche_id, platform)` walks a Job from queued → done.
Each stage persists the Job back to Postgres so Modal can resume on
failure. Per-scene image + animation fan-out is parallelized via asyncio.

Spend cap is checked before each credit-spending stage; if a niche has
hit its daily cap, the job fails fast with `error=spend_cap_exceeded`.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

from .config import settings
from .models import AudioTrack, Clip, Job, JobStatus, Niche, RenderedVideo, Scene, Script
from .orchestrator import run_ideation, run_qa, run_scriptwriter, run_visual_director
from .repos import jobs as jobs_repo
from .repos import niches as niches_repo
from .repos import spend as spend_repo
from .services import (
    character_sheet,
    ffmpeg,
    grok_imagine,
    music,
    openai_images,
    openai_tts,
    openai_whisper,
    scheduler,
    subtitle,
)
from .services.spend_context import SpendContext, default_context
from .storage.volume import ensure_layout

IMAGE_QUALITY = "medium"


async def _generate_scene_assets(
    scene: Scene,
    root: Path,
    *,
    reference_image: Path,
    spend: SpendContext,
) -> Clip:
    keyframe = root / "keyframes" / f"scene_{scene.index}.png"
    clip = root / "clips" / f"scene_{scene.index}.mp4"
    await openai_images.generate_keyframe(
        scene.visual_prompt,
        keyframe,
        quality=IMAGE_QUALITY,
        reference_image_path=reference_image,
        spend=spend,
    )
    await grok_imagine.animate(
        keyframe, scene.motion_prompt, clip,
        duration_sec=scene.duration_sec, spend=spend,
    )
    return Clip(
        scene_index=scene.index,
        keyframe_path=str(keyframe),
        video_path=str(clip),
        duration_sec=scene.duration_sec,
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
        return True
    except spend_repo.SpendCapExceeded as e:
        job.status = JobStatus.failed
        job.error = str(e)
        await _persist(job)
        return False


async def run_job(*, user_id: str, niche_id: UUID, platform: str) -> Job:
    niche = await niches_repo.get(niche_id, user_id=user_id)
    if niche is None:
        raise ValueError(f"niche {niche_id} not found for user {user_id}")
    if platform not in niche.platforms:
        raise ValueError(f"platform {platform} not enabled for niche {niche_id}")

    job = await jobs_repo.create(user_id=user_id, niche_id=niche_id, platform=platform)
    root = ensure_layout(f"{user_id}/{job.id}")
    spend = default_context(user_id=user_id, niche_id=niche_id, job_id=job.id)

    if not await _ensure_cap(job, niche):
        return job

    # 1. Ideation
    job.status = JobStatus.ideating
    await _persist(job)
    idea = await run_ideation(niche.title)

    # 2. Script + visual direction
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
    job.status = JobStatus.generating_images
    await _persist(job)
    reference = await character_sheet.get_or_create(
        niche, quality=IMAGE_QUALITY, spend=spend
    )
    job.clips = list(await asyncio.gather(
        *[
            _generate_scene_assets(s, root, reference_image=reference, spend=spend)
            for s in script.scenes
        ]
    ))
    job.status = JobStatus.animating
    await _persist(job)

    # 4. Voiceover
    if not await _ensure_cap(job, niche):
        return job
    job.status = JobStatus.voicing
    await _persist(job)
    vo_path = root / "audio" / "voiceover.wav"
    narration = " ".join(s.narration for s in script.scenes)
    await openai_tts.synthesize(narration, vo_path, voice=niche.voice, spend=spend)

    # 5. Music
    music_path = music.pick_track(
        mood="upbeat-educational",
        target_duration_sec=script.total_duration_sec,
        library_dir=Path(settings.assets_dir) / "music",
    )
    job.audio = AudioTrack(voiceover_path=str(vo_path), music_path=str(music_path))

    # 6. Edit (concat + mix)
    job.status = JobStatus.editing
    await _persist(job)
    silent_video = root / "output" / "silent.mp4"
    ffmpeg.concat_clips(
        [Path(c.video_path) for c in job.clips], silent_video, aspect=settings.aspect
    )
    mixed = root / "output" / "mixed.mp4"
    ffmpeg.mix_audio(
        silent_video, vo_path, music_path, mixed,
        music_gain_db=job.audio.music_gain_db,
    )

    # 7. Captions
    job.status = JobStatus.captioning
    await _persist(job)
    words = await openai_whisper.transcribe_word_level(vo_path, spend=spend)
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
    job.status = JobStatus.qa
    await _persist(job)
    transcript = " ".join(w["word"] for w in words)
    report = await run_qa(script, transcript, script.total_duration_sec, niche=niche)
    if not report.passed:
        job.status = JobStatus.failed
        job.error = "; ".join(report.issues)
        await _persist(job)
        return job

    # 9. Schedule via Ayrshare (per-user profile)
    job.status = JobStatus.scheduling
    await _persist(job)
    when = _next_posting_slot(niche)
    await scheduler.schedule_post(
        video_path=final,
        caption=idea.hook,
        hashtags=niche.hashtags,
        platform=platform,
        scheduled_for=when,
        profile_key=None,  # resolved inside scheduler from user_id
        user_id=user_id,
    )
    job.scheduled_for = when
    job.status = JobStatus.done
    await _persist(job)
    return job


def _next_posting_slot(niche: Niche) -> datetime:
    """Pick the soonest future posting window for this niche."""
    from datetime import timezone
    now = datetime.now(timezone.utc)
    candidates: list[datetime] = []
    for offset in (0, 1):
        day = now + timedelta(days=offset)
        for w in niche.posting_windows:
            candidates.append(w.at(day).astimezone(timezone.utc))
    future = [c for c in candidates if c > now]
    return min(future) if future else now + timedelta(hours=1)
