"""Archive a finished job's media into the library (and Wasabi).

Called once per job after render QA passes. For every artifact — scene
clips, keyframes, voiceover, final video — this:

1. uploads the file to Wasabi when object storage is configured
   (otherwise the asset is indexed where it already lives: the volume),
2. records a `media_assets` row so the library can list/play/remix it.

Fail-OPEN by design: the video already exists and QA already passed; a
storage hiccup must never fail the job. Errors are logged and the job
continues to approval/scheduling. Asset rows are idempotent on
(user, storage, key) so a stage-resumed job can't double-index.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID

from ..logging import get_logger
from ..models import Job, MediaAsset, Niche
from ..repos import media as media_repo
from . import object_storage

log = get_logger(__name__)


def _resolves_inside(path: Path, root: Path) -> bool:
    """True if `path` lives inside `root` once both are resolved.

    Used to tell a generated-in-job artifact (safe to mirror/bill as the
    user's own paid asset) apart from a shared library/Pixabay pick that
    merely happens to be referenced from the job (must never be uploaded
    as if it were bespoke media)."""
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


async def _archive_one(
    local_path: Path,
    *,
    user_id: str,
    job_id: UUID,
    niche_id: UUID,
    kind: str,
    relative_key: str,
    scene_index: int | None = None,
    duration_sec: float | None = None,
    content_type: str = "video/mp4",
    title: str = "",
) -> MediaAsset | None:
    if not local_path.exists():
        log.warning(
            "archive: artifact missing, skipping",
            extra={"path": str(local_path), "kind": kind},
        )
        return None

    if object_storage.enabled():
        storage = "wasabi"
        object_key = object_storage.job_key(user_id, str(job_id), relative_key)
        await object_storage.upload_file(local_path, object_key)
    else:
        # No object storage configured: index the artifact where it lives
        # so the library still works (served through the API from the
        # volume, subject to retention GC).
        storage = "volume"
        object_key = str(local_path)

    return await media_repo.record_asset(
        user_id=user_id,
        niche_id=niche_id,
        job_id=job_id,
        kind=kind,
        scene_index=scene_index,
        storage=storage,
        object_key=object_key,
        content_type=content_type,
        size_bytes=local_path.stat().st_size,
        duration_sec=duration_sec,
        title=title,
    )


async def archive_job_media(job: Job, niche: Niche) -> int:
    """Mirror + index every artifact of a rendered job. Returns how many
    assets were recorded. Never raises.

    Clip / keyframe / VO / music uploads fan out in one gather. Jev-curate
    on the final runs in that same beat; the final itself uploads after
    (only if keep). One failed artifact does not abort the rest.
    """
    archived = 0
    hook = job.script.idea.hook if job.script else ""
    try:
        pending: list = []
        for clip in job.clips:
            pending.append(
                _archive_one(
                    Path(clip.video_path),
                    user_id=job.user_id,
                    job_id=job.id,
                    niche_id=job.niche_id,
                    kind="clip",
                    relative_key=f"clips/scene_{clip.scene_index}.mp4",
                    scene_index=clip.scene_index,
                    duration_sec=clip.duration_sec,
                    title=f"{hook} — scene {clip.scene_index}" if hook else f"scene {clip.scene_index}",
                )
            )
            pending.append(
                _archive_one(
                    Path(clip.keyframe_path),
                    user_id=job.user_id,
                    job_id=job.id,
                    niche_id=job.niche_id,
                    kind="keyframe",
                    relative_key=f"keyframes/scene_{clip.scene_index}.png",
                    scene_index=clip.scene_index,
                    content_type="image/png",
                    title=f"{hook} — keyframe {clip.scene_index}" if hook else f"keyframe {clip.scene_index}",
                )
            )

        if job.audio is not None:
            pending.append(
                _archive_one(
                    Path(job.audio.voiceover_path),
                    user_id=job.user_id,
                    job_id=job.id,
                    niche_id=job.niche_id,
                    kind="voiceover",
                    relative_key="audio/voiceover.wav",
                    content_type="audio/wav",
                    title=f"{hook} — voiceover" if hook else "voiceover",
                )
            )

            # voiceover.wav always lives at <job_root>/audio/voiceover.wav
            # (see storage/volume.py's layout), so its grandparent is the
            # job root regardless of how the caller laid out user/job
            # nesting above it — a stable anchor with no extra dependency.
            job_root = Path(job.audio.voiceover_path).parent.parent

            # Generated background score: an original ElevenLabs
            # composition billed to the user (pipeline.py writes it to
            # <job_root>/audio/music_generated.mp3). Only archive it when
            # music_path resolves INSIDE the job root — a shared
            # library/Pixabay track (served from settings.assets_dir) is
            # never the user's bespoke media and must never be uploaded
            # as if it were.
            if job.audio.music_path:
                music_path = Path(job.audio.music_path)
                if _resolves_inside(music_path, job_root):
                    pending.append(
                        _archive_one(
                            music_path,
                            user_id=job.user_id,
                            job_id=job.id,
                            niche_id=job.niche_id,
                            kind="music",
                            relative_key="audio/music_generated.mp3",
                            content_type="audio/mpeg",
                            title=f"{hook} — music" if hook else "music",
                        )
                    )
                else:
                    log.info(
                        "archive: music_path outside job root, "
                        "shared library track — not archiving",
                        extra={"job_id": str(job.id), "music_path": str(music_path)},
                    )

            # Per-scene ElevenLabs narration in avatar (lip-sync) mode:
            # each scene's standalone WAV drives the avatar render and is
            # separately billed, but only voiceover.wav (extracted from
            # the assembled video) was ever archived. These files only
            # exist for avatar-mode jobs, so a missing scene wav is
            # expected and not logged as an anomaly.
            for clip in job.clips:
                scene_wav = job_root / "audio" / f"scene_{clip.scene_index}.wav"
                if not scene_wav.exists():
                    continue
                pending.append(
                    _archive_one(
                        scene_wav,
                        user_id=job.user_id,
                        job_id=job.id,
                        niche_id=job.niche_id,
                        kind="voiceover",
                        relative_key=f"audio/scene_{clip.scene_index}.wav",
                        scene_index=clip.scene_index,
                        content_type="audio/wav",
                        title=(
                            f"{hook} — scene {clip.scene_index} voiceover"
                            if hook
                            else f"scene {clip.scene_index} voiceover"
                        ),
                    )
                )

        curate_idx: int | None = None
        if job.rendered is not None:
            from ..jev.loops import should_index_asset

            curate_idx = len(pending)
            pending.append(
                should_index_asset(
                    {
                        "kind": "final",
                        "title": hook or f"video {job.id}",
                        "niche": niche.title,
                        "hook": hook,
                        "platform": job.platform,
                    }
                )
            )

        keep_final = True
        if pending:
            results = await asyncio.gather(*pending, return_exceptions=True)
            for i, result in enumerate(results):
                if curate_idx is not None and i == curate_idx:
                    if isinstance(result, Exception):
                        log.warning(
                            "archive: curate failed (keep)",
                            extra={"job_id": str(job.id), "error": str(result)},
                        )
                        keep_final = True
                    else:
                        keep_final = bool(result)
                    continue
                if isinstance(result, Exception):
                    log.warning(
                        "archive: artifact failed",
                        extra={"job_id": str(job.id), "error": str(result)},
                    )
                elif result is not None:
                    archived += 1

        if job.rendered is not None and keep_final:
            asset = await _archive_one(
                Path(job.rendered.path),
                user_id=job.user_id,
                job_id=job.id,
                niche_id=job.niche_id,
                kind="final",
                relative_key="output/" + Path(job.rendered.path).name,
                duration_sec=job.rendered.duration_sec,
                title=hook or f"video {job.id}",
            )
            archived += asset is not None
        elif job.rendered is not None:
            log.info(
                "archive: jev-curate discarded final",
                extra={"job_id": str(job.id)},
            )
    except Exception as e:  # noqa: BLE001 — storage never breaks a rendered job
        log.warning(
            "archive: media archiving failed (job continues)",
            extra={"job_id": str(job.id), "error": str(e)},
        )
    return archived


async def _archive_image_slide(
    path: Path,
    *,
    user_id: str,
    niche_id: UUID,
    image_post_id: UUID,
    index: int,
    title: str,
) -> bool:
    if not path.exists():
        return False
    if object_storage.enabled():
        storage = "wasabi"
        key = f"users/{user_id}/imageposts/{image_post_id}/slide_{index}.png"
        await object_storage.upload_file(path, key)
    else:
        storage, key = "volume", str(path)
    await media_repo.record_asset(
        user_id=user_id,
        niche_id=niche_id,
        kind="keyframe",
        scene_index=index,
        storage=storage,
        object_key=key,
        content_type="image/png",
        size_bytes=path.stat().st_size,
        title=f"{title} — slide {index + 1}" if title else f"slide {index + 1}",
    )
    return True


async def archive_image_slides(
    *,
    user_id: str,
    niche_id: UUID,
    image_post_id: UUID,
    slide_paths: list[Path],
    title: str = "",
) -> int:
    """Index carousel/still slides as library keyframe assets (uploaded to
    Wasabi when configured). Uploads fan out in one gather. Never raises."""
    archived = 0
    try:
        pending = [
            _archive_image_slide(
                path,
                user_id=user_id,
                niche_id=niche_id,
                image_post_id=image_post_id,
                index=i,
                title=title,
            )
            for i, path in enumerate(slide_paths)
        ]
        if not pending:
            return 0
        results = await asyncio.gather(*pending, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                log.warning("image slide archive failed", extra={"error": str(result)})
                continue
            if result:
                archived += 1
    except Exception as e:  # noqa: BLE001
        log.warning("image slide archive failed", extra={"error": str(e)})
    return archived
