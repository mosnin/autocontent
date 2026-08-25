"""Artifact retention GC.

Walks the artifacts volume and removes job directories whose mtime is
older than the retention horizon. DB rows in `jobs` are NOT touched —
they keep the audit/cost history; only the heavy artifacts go.

Volume layout assumes `/artifacts/<user_id>/<job_id>/...` (matches
pipeline.run_job which ensures `f"{user_id}/{job.id}"`).
"""
from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from ..config import settings


@dataclass
class GCResult:
    scanned: int
    removed: int
    bytes_freed: int


def _dir_size(path: Path) -> int:
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            continue
    return total


def gc_artifacts(*, max_age_days: int = 30, root: Path | None = None) -> GCResult:
    base = root if root is not None else Path(settings.artifacts_dir)
    if not base.exists():
        return GCResult(scanned=0, removed=0, bytes_freed=0)

    cutoff = time.time() - (max_age_days * 86400)
    scanned = removed = bytes_freed = 0

    for user_dir in base.iterdir():
        if not user_dir.is_dir():
            continue
        for job_dir in user_dir.iterdir():
            if not job_dir.is_dir():
                continue
            scanned += 1
            try:
                mtime = job_dir.stat().st_mtime
            except OSError:
                continue
            if mtime < cutoff:
                size = _dir_size(job_dir)
                shutil.rmtree(job_dir, ignore_errors=True)
                removed += 1
                bytes_freed += size

    return GCResult(scanned=scanned, removed=removed, bytes_freed=bytes_freed)


async def gc_media_library(*, max_age_days: int = 30) -> GCResult:
    """Delete aged media_assets rows and their Wasabi objects.

    Volume-only rows are left to ``gc_artifacts`` (directory mtime).
    Missing Wasabi objects still drop the index row so the library does
    not keep ghosts.
    """
    from ..db import get_pool
    from ..services import object_storage

    pool = await get_pool()
    rows = await pool.fetch(
        """
        select id, storage, object_key, size_bytes
          from media_assets
         where created_at < now() - make_interval(days => $1)
        """,
        max_age_days,
    )
    scanned = removed = bytes_freed = 0
    for row in rows:
        scanned += 1
        if row["storage"] == "wasabi" and object_storage.enabled():
            try:
                await object_storage.delete_object(row["object_key"])
            except Exception as exc:  # noqa: BLE001 — still drop the index row
                from ..logging import get_logger

                get_logger(__name__).warning(
                    "wasabi delete failed during media GC",
                    extra={"key": row["object_key"], "error": str(exc)},
                )
        await pool.execute("delete from media_assets where id = $1", row["id"])
        removed += 1
        bytes_freed += int(row["size_bytes"] or 0)
    return GCResult(scanned=scanned, removed=removed, bytes_freed=bytes_freed)
