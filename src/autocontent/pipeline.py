"""End-to-end pipeline entrypoint.

`run_job(niche)` walks a Job from queued → done. Each stage is isolated so
Modal can checkpoint between them and resume on failure. Image + animation
fan-out per scene is parallelized via asyncio.gather.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from .config import settings
from .models import AudioTrack, Clip, Job, JobStatus, RenderedVideo, Scene, Script
from .orchestrator import run_ideation, run_qa, run_scriptwriter, run_visual_director
from .services import captions, dalle, ffmpeg, grok_imagine, music, scheduler, tts
from .storage.volume import ensure_layout, job_root


async def _generate_scene_assets(scene: Scene, root: Path) -> Clip:
    keyframe = root / "keyframes" / f"scene_{scene.index}.png"
    clip = root / "clips" / f"scene_{scene.index}.mp4"
    await dalle.generate_keyframe(scene.visual_prompt, keyframe)
    await grok_imagine.animate(keyframe, scene.motion_prompt, clip,
                               duration_sec=scene.duration_sec)
    return Clip(
        scene_index=scene.index,
        keyframe_path=str(keyframe),
        video_path=str(clip),
        duration_sec=scene.duration_sec,
    )


async def run_job(niche: str, platform: str = "tiktok") -> Job:
    job = Job(id=str(uuid.uuid4())[:8], niche=niche, platform=platform)  # type: ignore[arg-type]
    root = ensure_layout(job.id)

    # 1. Ideation
    job.status = JobStatus.ideating
    idea = await run_ideation(niche)

    # 2. Script
    job.status = JobStatus.scripting
    script: Script = await run_scriptwriter(idea)
    script = await run_visual_director(script)
    job.script = script
    (root / "script.json").write_text(script.model_dump_json(indent=2))

    # 3. Images + animation (fan-out)
    job.status = JobStatus.generating_images
    job.clips = await asyncio.gather(
        *[_generate_scene_assets(s, root) for s in script.scenes]
    )
    job.status = JobStatus.animating  # marker; real work just finished above

    # 4. Voiceover
    job.status = JobStatus.voicing
    vo_path = root / "audio" / "voiceover.wav"
    narration = " ".join(s.narration for s in script.scenes)
    await tts.synthesize(narration, vo_path)

    # 5. Music
    music_path = music.pick_track(
        mood="upbeat-educational",
        target_duration_sec=script.total_duration_sec,
        library_dir=Path(settings.assets_dir) / "music",
    )
    job.audio = AudioTrack(voiceover_path=str(vo_path), music_path=str(music_path))

    # 6. Edit (concat + mix)
    job.status = JobStatus.editing
    silent_video = root / "output" / "silent.mp4"
    ffmpeg.concat_clips([Path(c.video_path) for c in job.clips], silent_video,
                        aspect=settings.aspect)
    mixed = root / "output" / "mixed.mp4"
    ffmpeg.mix_audio(silent_video, vo_path, music_path, mixed,
                     music_gain_db=job.audio.music_gain_db)

    # 7. Captions
    job.status = JobStatus.captioning
    words = await captions.transcribe_word_level(vo_path)
    ass_path = root / "captions" / "subs.ass"
    captions.words_to_ass(words, ass_path)
    final = root / "output" / "final.mp4"
    ffmpeg.burn_subtitles(mixed, ass_path, final)
    job.rendered = RenderedVideo(
        path=str(final),
        duration_sec=script.total_duration_sec,
        captions_path=str(ass_path),
    )

    # 8. QA
    job.status = JobStatus.qa
    transcript = " ".join(w["word"] for w in words)
    report = await run_qa(script, transcript, script.total_duration_sec)
    if not report.passed:
        job.status = JobStatus.failed
        job.error = "; ".join(report.issues)
        (root / "job.json").write_text(job.model_dump_json(indent=2))
        return job

    # 9. Schedule
    job.status = JobStatus.scheduling
    when = datetime.utcnow() + timedelta(hours=1)
    await scheduler.schedule_post(
        video_path=final,
        caption=idea.hook,
        hashtags=[],
        platform=platform,
        scheduled_for=when,
    )
    job.scheduled_for = when
    job.status = JobStatus.done
    (root / "job.json").write_text(job.model_dump_json(indent=2))
    return job
