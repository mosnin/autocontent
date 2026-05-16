from __future__ import annotations

import os
import time
from pathlib import Path

from autocontent.storage.retention import gc_artifacts


def _seed_job(root: Path, user: str, job: str, *, age_days: float, size: int = 1024) -> Path:
    d = root / user / job
    d.mkdir(parents=True, exist_ok=True)
    f = d / "final.mp4"
    f.write_bytes(b"x" * size)
    past = time.time() - age_days * 86400
    os.utime(d, (past, past))
    return d


def test_gc_removes_old_and_keeps_fresh(tmp_path: Path):
    old = _seed_job(tmp_path, "user_a", "job_old", age_days=45, size=2048)
    fresh = _seed_job(tmp_path, "user_a", "job_fresh", age_days=1)
    other_user_old = _seed_job(tmp_path, "user_b", "job_old2", age_days=60, size=4096)

    result = gc_artifacts(max_age_days=30, root=tmp_path)

    assert result.scanned == 3
    assert result.removed == 2
    assert result.bytes_freed >= 2048 + 4096
    assert not old.exists()
    assert not other_user_old.exists()
    assert fresh.exists()


def test_gc_handles_missing_root(tmp_path: Path):
    result = gc_artifacts(max_age_days=30, root=tmp_path / "does-not-exist")
    assert result.scanned == 0
    assert result.removed == 0


def test_gc_ignores_loose_files(tmp_path: Path):
    (tmp_path / "stray.txt").write_text("hi")
    _seed_job(tmp_path, "user_a", "job_old", age_days=45)
    result = gc_artifacts(max_age_days=30, root=tmp_path)
    assert result.scanned == 1
    assert result.removed == 1
