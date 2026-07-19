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

from pathlib import Path
from uuid import UUID

from ..logging import get_logger
from ..models import Job, MediaAsset, Niche
from ..repos import media as media_repo
from . import object_storage

log = get_logger(__name__)


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
    assets were recorded. Never raises."""
    archived = 0
    hook = job.script.idea.hook if job.script else ""
    try:
        for clip in job.clips:
            asset = await _archive_one(
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
            archived += asset is not None

            keyframe = Path(clip.keyframe_path)
            asset = await _archive_one(
                keyframe,
                user_id=job.user_id,
                job_id=job.id,
                niche_id=job.niche_id,
                kind="keyframe",
                relative_key=f"keyframes/scene_{clip.scene_index}.png",
                scene_index=clip.scene_index,
                content_type="image/png",
                title=f"{hook} — keyframe {clip.scene_index}" if hook else f"keyframe {clip.scene_index}",
            )
            archived += asset is not None

        if job.audio is not None:
            asset = await _archive_one(
                Path(job.audio.voiceover_path),
                user_id=job.user_id,
                job_id=job.id,
                niche_id=job.niche_id,
                kind="voiceover",
                relative_key="audio/voiceover.wav",
                content_type="audio/wav",
                title=f"{hook} — voiceover" if hook else "voiceover",
            )
            archived += asset is not None

        if job.rendered is not None:
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
    except Exception as e:  # noqa: BLE001 — storage never breaks a rendered job
        log.warning(
            "archive: media archiving failed (job continues)",
            extra={"job_id": str(job.id), "error": str(e)},
        )
    return archived


async def archive_image_slides(
    *,
    user_id: str,
    niche_id: UUID,
    image_post_id: UUID,
    slide_paths: list[Path],
    title: str = "",
) -> int:
    """Index carousel/still slides as library keyframe assets (uploaded to
    Wasabi when configured). Never raises."""
    archived = 0
    try:
        for i, path in enumerate(slide_paths):
            if not path.exists():
                continue
            if object_storage.enabled():
                storage = "wasabi"
                key = f"users/{user_id}/imageposts/{image_post_id}/slide_{i}.png"
                await object_storage.upload_file(path, key)
            else:
                storage, key = "volume", str(path)
            await media_repo.record_asset(
                user_id=user_id,
                niche_id=niche_id,
                kind="keyframe",
                scene_index=i,
                storage=storage,
                object_key=key,
                content_type="image/png",
                size_bytes=path.stat().st_size,
                title=f"{title} — slide {i + 1}" if title else f"slide {i + 1}",
            )
            archived += 1
    except Exception as e:  # noqa: BLE001
        log.warning("image slide archive failed", extra={"error": str(e)})
    return archived
