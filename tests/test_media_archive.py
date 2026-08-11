"""Tests for the post-render media archiver (repos + storage mocked)."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from marketer.models import (
    AudioTrack,
    Clip,
    Idea,
    Job,
    JobStatus,
    MediaAsset,
    Niche,
    PostingWindow,
    RenderedVideo,
    Scene,
    Script,
)
from marketer.services import media_archive, object_storage

USER = "user_arch"
NICHE_ID = UUID("00000000-0000-0000-0000-00000000a11b")


def _niche() -> Niche:
    return Niche(
        id=NICHE_ID, user_id=USER, title="t", description="d",
        target_audience="a", visual_style="v", voice="onyx",
        target_duration_sec=30, scene_count=1,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=["tiktok"], daily_spend_cap_usd=Decimal("5"),
    )


def _job(tmp_path: Path) -> Job:
    (tmp_path / "clips").mkdir()
    (tmp_path / "keyframes").mkdir()
    (tmp_path / "audio").mkdir()
    (tmp_path / "output").mkdir()
    clip = tmp_path / "clips" / "scene_0.mp4"
    kf = tmp_path / "keyframes" / "scene_0.png"
    vo = tmp_path / "audio" / "voiceover.wav"
    final = tmp_path / "output" / "final.mp4"
    for f in (clip, kf, vo, final):
        f.write_bytes(b"DATA")
    script = Script(
        idea=Idea(topic="t", angle="a", hook="the hook",
                  target_audience="x", why_it_works="y"),
        scenes=[Scene(index=0, narration="n", visual_prompt="v",
                      motion_prompt="m", duration_sec=5)],
        total_duration_sec=5,
    )
    return Job(
        id=uuid4(), user_id=USER, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.qa, script=script,
        clips=[Clip(scene_index=0, keyframe_path=str(kf),
                    video_path=str(clip), duration_sec=5)],
        audio=AudioTrack(voiceover_path=str(vo)),
        rendered=RenderedVideo(path=str(final), duration_sec=5.0),
    )


@pytest.fixture
def recorded(monkeypatch):
    """Capture media_repo.record_asset calls."""
    from marketer.repos import media as media_repo

    rows: list[dict] = []

    async def fake_record(**kwargs):
        rows.append(kwargs)
        return MediaAsset(
            id=uuid4(), user_id=kwargs["user_id"], kind=kwargs["kind"],
            storage=kwargs["storage"], object_key=kwargs["object_key"],
        )

    monkeypatch.setattr(media_repo, "record_asset", fake_record)
    return rows


async def test_volume_indexing_when_wasabi_disabled(tmp_path: Path, recorded):
    job = _job(tmp_path)
    n = await media_archive.archive_job_media(job, _niche())

    assert n == 4  # clip + keyframe + voiceover + final
    kinds = sorted(r["kind"] for r in recorded)
    assert kinds == ["clip", "final", "keyframe", "voiceover"]
    assert all(r["storage"] == "volume" for r in recorded)
    final_row = next(r for r in recorded if r["kind"] == "final")
    assert final_row["title"] == "the hook"
    assert final_row["object_key"] == job.rendered.path


async def test_wasabi_upload_when_enabled(tmp_path: Path, recorded, monkeypatch):
    uploads: list[tuple[str, str]] = []

    monkeypatch.setattr(object_storage, "enabled", lambda: True)

    async def fake_upload(local, key):
        uploads.append((str(local), key))
        return key

    monkeypatch.setattr(object_storage, "upload_file", fake_upload)

    job = _job(tmp_path)
    n = await media_archive.archive_job_media(job, _niche())

    assert n == 4
    assert all(r["storage"] == "wasabi" for r in recorded)
    keys = [k for _, k in uploads]
    prefix = f"users/{USER}/{job.id}/"
    assert all(k.startswith(prefix) for k in keys)
    assert f"{prefix}clips/scene_0.mp4" in keys
    assert f"{prefix}output/final.mp4" in keys


async def test_archive_is_fail_open(tmp_path: Path, monkeypatch):
    from marketer.repos import media as media_repo

    async def boom(**kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(media_repo, "record_asset", boom)

    job = _job(tmp_path)
    # must not raise — a storage problem never fails a rendered job
    n = await media_archive.archive_job_media(job, _niche())
    assert n == 0


async def test_missing_files_skipped_not_fatal(tmp_path: Path, recorded):
    job = _job(tmp_path)
    Path(job.clips[0].video_path).unlink()

    n = await media_archive.archive_job_media(job, _niche())
    kinds = sorted(r["kind"] for r in recorded)
    assert "clip" not in kinds
    assert n == 3
