"""Render a composition: a new video concatenated from library clips.

This is the "systemized" editing path — instead of re-generating scenes,
existing clips are re-ordered/re-combined into new videos:

1. atomically claim the composition (queued -> rendering),
2. materialize each clip locally (Wasabi download, or already on the
   volume),
3. concat with the standard scale/pad chain; `audio_mode='keep'` passes
   clip audio through when *every* clip has an audio stream (pipeline
   scene clips are silent — those concat silent),
4. store the output like any pipeline artifact (Wasabi when configured)
   and index it as a `composition` media asset,
5. mark done/failed.

Runs inside the Modal `render_composition` function; everything here is
per-user scoped.
"""
from __future__ import annotations

from pathlib import Path
from uuid import UUID

from ..config import settings
from ..logging import get_logger
from ..models import Composition
from ..repos import media as media_repo
from . import ffmpeg, object_storage

log = get_logger(__name__)


class ComposeError(RuntimeError):
    pass


def _workdir(user_id: str, composition_id: UUID) -> Path:
    d = Path(settings.artifacts_dir) / user_id / "compositions" / str(composition_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


async def _materialize_clip(asset, workdir: Path, index: int) -> Path:
    if asset.storage == "wasabi":
        return await object_storage.download_file(
            asset.object_key, workdir / f"in_{index}.mp4"
        )
    local = Path(asset.object_key)
    if not local.exists():
        raise ComposeError(
            f"clip {asset.id} no longer on the volume (retention GC?) — "
            "re-render the source job or enable object storage"
        )
    return local


async def render_composition(*, user_id: str, composition_id: UUID) -> Composition:
    comp = await media_repo.get_composition(composition_id, user_id=user_id)
    if comp is None:
        raise ComposeError(f"composition {composition_id} not found for {user_id}")
    if not await media_repo.claim_composition_for_render(
        composition_id, user_id=user_id
    ):
        # Already rendering/done/failed — idempotent no-op for double spawns.
        return comp

    try:
        assets = await media_repo.get_assets_bulk(comp.clip_asset_ids, user_id=user_id)
        by_id = {a.id: a for a in assets}
        missing = [str(i) for i in comp.clip_asset_ids if i not in by_id]
        if missing:
            raise ComposeError(f"clips not found: {', '.join(missing)}")
        non_clips = [str(a.id) for a in assets if a.kind not in ("clip", "final", "composition")]
        if non_clips:
            raise ComposeError(f"assets are not video clips: {', '.join(non_clips)}")

        workdir = _workdir(user_id, composition_id)
        ordered = [by_id[i] for i in comp.clip_asset_ids]
        local_paths = []
        for idx, asset in enumerate(ordered):
            local_paths.append(await _materialize_clip(asset, workdir, idx))

        keep_audio = comp.audio_mode == "keep" and all(
            ffmpeg.probe_has_audio(p) for p in local_paths
        )
        out_path = workdir / "composition.mp4"
        ffmpeg.concat_clips(
            local_paths, out_path, aspect=settings.aspect, keep_audio=keep_audio
        )
        duration = ffmpeg.probe_duration(out_path)

        if object_storage.enabled():
            storage = "wasabi"
            object_key = object_storage.composition_key(user_id, str(composition_id))
            await object_storage.upload_file(out_path, object_key)
        else:
            storage = "volume"
            object_key = str(out_path)

        asset = await media_repo.record_asset(
            user_id=user_id,
            kind="composition",
            storage=storage,
            object_key=object_key,
            size_bytes=out_path.stat().st_size,
            duration_sec=duration,
            title=comp.title or f"composition {composition_id}",
        )
        updated = await media_repo.set_composition_status(
            composition_id, user_id=user_id, status="done", output_asset_id=asset.id
        )
        return updated or comp
    except Exception as e:  # noqa: BLE001 — terminal state, never a zombie row
        log.warning(
            "composition render failed",
            extra={"composition_id": str(composition_id), "error": str(e)},
        )
        updated = await media_repo.set_composition_status(
            composition_id, user_id=user_id, status="failed",
            error=f"{type(e).__name__}: {e}",
        )
        return updated or comp
