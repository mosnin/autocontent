"""Hardening tests for the wave-5 archival gaps: generated music and
per-scene avatar-mode narration must be mirrored + indexed like every
other paid artifact, while shared library/Pixabay tracks must never be
uploaded as if they were bespoke media.

Mirrors the fixtures/conventions in tests/test_media_archive.py.
"""
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


def _script() -> Script:
    return Script(
        idea=Idea(topic="t", angle="a", hook="the hook",
                  target_audience="x", why_it_works="y"),
        scenes=[Scene(index=0, narration="n", visual_prompt="v",
                      motion_prompt="m", duration_sec=5)],
        total_duration_sec=5,
    )


def _base_job(tmp_path: Path) -> Job:
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
    return Job(
        id=uuid4(), user_id=USER, niche_id=NICHE_ID, platform="tiktok",
        status=JobStatus.qa, script=_script(),
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


async def test_generated_music_in_job_root_is_archived(tmp_path: Path, recorded):
    job = _base_job(tmp_path)
    music = tmp_path / "audio" / "music_generated.mp3"
    music.write_bytes(b"MP3")
    job.audio.music_path = str(music)

    n = await media_archive.archive_job_media(job, _niche())

    kinds = sorted(r["kind"] for r in recorded)
    assert "music" in kinds
    assert n == 5  # clip + keyframe + voiceover + music + final
    music_row = next(r for r in recorded if r["kind"] == "music")
    assert music_row["content_type"] == "audio/mpeg"
    assert music_row["object_key"] == str(music)  # volume storage: indexed in place
    assert music_row["storage"] == "volume"


async def test_generated_music_uploaded_to_wasabi_with_stable_key(
    tmp_path: Path, recorded, monkeypatch
):
    uploads: list[tuple[str, str]] = []
    monkeypatch.setattr(object_storage, "enabled", lambda: True)

    async def fake_upload(local, key):
        uploads.append((str(local), key))
        return key

    monkeypatch.setattr(object_storage, "upload_file", fake_upload)

    job = _base_job(tmp_path)
    music = tmp_path / "audio" / "music_generated.mp3"
    music.write_bytes(b"MP3")
    job.audio.music_path = str(music)

    await media_archive.archive_job_media(job, _niche())

    prefix = f"users/{USER}/{job.id}/"
    assert f"{prefix}audio/music_generated.mp3" in [k for _, k in uploads]


async def test_shared_library_track_outside_job_root_not_archived(
    tmp_path: Path, recorded
):
    """A Pixabay/library pick lives under settings.assets_dir, not the job
    root — it must never be mirrored/billed as the user's own media."""
    job = _base_job(tmp_path)
    library_dir = tmp_path.parent / "shared_assets_dir" / "music"
    library_dir.mkdir(parents=True)
    shared_track = library_dir / "chill_lofi_01.mp3"
    shared_track.write_bytes(b"MP3")
    job.audio.music_path = str(shared_track)

    n = await media_archive.archive_job_media(job, _niche())

    kinds = [r["kind"] for r in recorded]
    assert "music" not in kinds
    assert n == 4  # clip + keyframe + voiceover + final — unchanged


async def test_no_music_path_set_archives_nothing_extra(tmp_path: Path, recorded):
    job = _base_job(tmp_path)
    assert job.audio.music_path is None

    n = await media_archive.archive_job_media(job, _niche())

    assert n == 4
    assert "music" not in [r["kind"] for r in recorded]


async def test_avatar_mode_scene_wavs_are_archived(tmp_path: Path, recorded):
    job = _base_job(tmp_path)
    scene_wav = tmp_path / "audio" / "scene_0.wav"
    scene_wav.write_bytes(b"WAV")

    n = await media_archive.archive_job_media(job, _niche())

    scene_rows = [r for r in recorded if r["kind"] == "voiceover" and r.get("scene_index") == 0]
    # one is the extracted voiceover.wav row (scene_index None) and one is
    # the per-scene wav (scene_index 0) — only the latter should match here
    assert len(scene_rows) == 1
    row = scene_rows[0]
    assert row["content_type"] == "audio/wav"
    assert row["object_key"] == str(scene_wav)
    assert n == 5  # clip + keyframe + voiceover + scene wav + final


async def test_non_avatar_mode_missing_scene_wav_skipped_quietly(
    tmp_path: Path, recorded
):
    """Non-avatar jobs never produce audio/scene_N.wav — absence must not
    be treated as an error (unlike a genuinely-missing clip)."""
    job = _base_job(tmp_path)
    assert not (tmp_path / "audio" / "scene_0.wav").exists()

    n = await media_archive.archive_job_media(job, _niche())

    assert n == 4
    scene_rows = [r for r in recorded if r["kind"] == "voiceover" and r.get("scene_index") == 0]
    assert scene_rows == []


async def test_music_and_scene_wav_together(tmp_path: Path, recorded):
    job = _base_job(tmp_path)
    music = tmp_path / "audio" / "music_generated.mp3"
    music.write_bytes(b"MP3")
    job.audio.music_path = str(music)
    scene_wav = tmp_path / "audio" / "scene_0.wav"
    scene_wav.write_bytes(b"WAV")

    n = await media_archive.archive_job_media(job, _niche())

    assert n == 6  # clip + keyframe + voiceover + music + scene wav + final
    kinds = sorted(r["kind"] for r in recorded)
    assert kinds.count("music") == 1
    assert kinds.count("voiceover") == 2


async def test_music_archive_is_fail_open(tmp_path: Path, monkeypatch):
    """A DB hiccup while archiving music must not raise — same fail-open
    contract as the rest of archive_job_media."""
    from marketer.repos import media as media_repo

    async def boom(**kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(media_repo, "record_asset", boom)

    job = _base_job(tmp_path)
    music = tmp_path / "audio" / "music_generated.mp3"
    music.write_bytes(b"MP3")
    job.audio.music_path = str(music)

    n = await media_archive.archive_job_media(job, _niche())
    assert n == 0
