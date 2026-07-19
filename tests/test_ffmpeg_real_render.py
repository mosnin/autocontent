"""Real-render integration tests: actual ffmpeg, actual files.

Every other ffmpeg test asserts constructed argv against a monkeypatched
runner — fast, but it can't catch a broken filter graph. These tests
synthesize tiny real inputs (color video, sine-tone WAVs), run the true
concat → mix → burn → re-encode chain, and ffprobe the results.

Skipped automatically when ffmpeg/ffprobe aren't on PATH (CI images and
the Modal runtime have them; a bare dev box may not).
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from marketer.services import ffmpeg, subtitle

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not installed",
)


def _make_clip(path: Path, seconds: float, size: str = "320x568") -> Path:
    """Tiny real mp4: solid color + testsrc-free (lavfi color source)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"color=c=blue:s={size}:d={seconds}:r=24",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(path),
        ],
        check=True,
    )
    return path


def _make_tone(path: Path, seconds: float, volume: str = "0.5") -> Path:
    """Real WAV sine tone so loudness measurement has signal."""
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
            "-af", f"volume={volume}",
            "-ar", "24000",
            str(path),
        ],
        check=True,
    )
    return path


def test_full_chain_concat_mix_burn(tmp_path: Path):
    clips = [_make_clip(tmp_path / f"c{i}.mp4", 1.0) for i in range(2)]
    vo = _make_tone(tmp_path / "vo.wav", 1.8)
    music = _make_tone(tmp_path / "music.wav", 3.0, volume="0.2")

    silent = ffmpeg.concat_clips(clips, tmp_path / "silent.mp4", aspect="9:16")
    assert abs(ffmpeg.probe_duration(silent) - 2.0) < 0.2

    mixed = ffmpeg.mix_audio(silent, vo, music, tmp_path / "mixed.mp4")
    assert ffmpeg.probe_has_audio(mixed)
    mean_db = ffmpeg.measure_mean_volume_db(mixed)
    assert mean_db is not None and mean_db > -45.0

    words = [
        {"word": "hello", "start": 0.0, "end": 0.6},
        {"word": "world", "start": 0.6, "end": 1.2},
    ]
    ass = subtitle.words_to_ass(words, tmp_path / "subs.ass")
    final = ffmpeg.burn_subtitles(mixed, ass, tmp_path / "final.mp4")

    assert final.exists() and final.stat().st_size > 10_000
    assert ffmpeg.probe_has_audio(final)
    assert abs(ffmpeg.probe_duration(final) - 2.0) < 0.3


def test_mix_pads_video_so_vo_never_cut(tmp_path: Path):
    """VO longer than the video -> output stretches to cover narration."""
    clip = _make_clip(tmp_path / "c.mp4", 1.0)
    vo = _make_tone(tmp_path / "vo.wav", 2.5)

    silent = ffmpeg.concat_clips([clip], tmp_path / "silent.mp4")
    mixed = ffmpeg.mix_audio(silent, vo, None, tmp_path / "mixed.mp4")

    out_duration = ffmpeg.probe_duration(mixed)
    # must cover the 2.5s VO (plus tail), never the raw 1.0s video
    assert out_duration >= 2.5 - 0.1


def test_reencode_to_size_actually_shrinks(tmp_path: Path):
    # a deliberately chunky clip: noise compresses badly
    src = tmp_path / "big.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc2=s=640x1136:d=4:r=30",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
            "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            str(src),
        ],
        check=True,
    )
    budget = max(src.stat().st_size // 2, 60_000)
    out = ffmpeg.reencode_to_size(src, tmp_path / "fit.mp4", max_bytes=budget)
    assert out.stat().st_size <= budget
    assert ffmpeg.probe_has_audio(out)
    assert abs(ffmpeg.probe_duration(out) - 4.0) < 0.3
