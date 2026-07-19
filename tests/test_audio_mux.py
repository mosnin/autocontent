"""Tests for the audio-mux correctness/robustness fixes in ffmpeg.py and
the enforce_duration gate in video_qa.py.

Follows the style of tests/test_ffmpeg.py: monkeypatch ffmpeg._run and
assert on the constructed argv, rather than spawning real ffmpeg.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from marketer.services import ffmpeg, video_qa


@pytest.fixture
def capture(monkeypatch):
    calls: list[list[str]] = []

    def _fake_run(cmd: list[str]) -> None:
        calls.append(cmd)

    monkeypatch.setattr(ffmpeg, "_run", _fake_run)
    return calls


@pytest.fixture
def durations(monkeypatch):
    """Stub probe_duration with a per-path mapping (falls back to 10s)."""
    table: dict[str, float] = {}
    monkeypatch.setattr(
        ffmpeg, "probe_duration", lambda p: table.get(str(p), 10.0)
    )
    return table


@pytest.fixture
def has_audio(monkeypatch):
    """Stub probe_has_audio with a per-path mapping (defaults to True)."""
    table: dict[str, bool] = {}
    monkeypatch.setattr(
        ffmpeg, "probe_has_audio", lambda p: table.get(str(p), True)
    )
    return table


# --- mix_music_over: duration correctness -----------------------------


def test_mix_music_over_uses_longest_and_pins_duration(tmp_path: Path, capture, durations):
    video = tmp_path / "avatar.mp4"
    music = tmp_path / "music.mp3"
    out = tmp_path / "mixed.mp4"
    for p in (video, music):
        p.write_bytes(b"x")
    durations[str(video)] = 27.75  # narration-driven length

    ffmpeg.mix_music_over(video, music, out, music_gain_db=-20.0)

    assert len(capture) == 1
    cmd = capture[0]
    fc = cmd[cmd.index("-filter_complex") + 1]

    # Must not truncate to the (potentially shorter) music-derived stream.
    assert "duration=first" not in fc
    assert "amix=inputs=2:duration=longest" in fc

    # Output must be hard-pinned to the video's own (narration) duration.
    assert "-t" in cmd
    t_idx = cmd.index("-t")
    assert cmd[t_idx + 1] == "27.750"

    assert "volume=-20.0dB" in fc
    assert "-map" in cmd and "0:v" in cmd
    assert "[a]" in cmd
    assert "-c:v" in cmd and "copy" in cmd


def test_mix_music_over_sidechain_keyed_off_video_audio(tmp_path: Path, capture, durations):
    """The music is the signal being compressed; the video's own audio
    (narration) is the sidechain key — mirrors mix_audio's ordering where
    the VO is always the key, never the thing that gets attenuated."""
    video = tmp_path / "avatar.mp4"
    music = tmp_path / "music.mp3"
    out = tmp_path / "mixed.mp4"
    for p in (video, music):
        p.write_bytes(b"x")

    ffmpeg.mix_music_over(video, music, out)

    cmd = capture[0]
    fc = cmd[cmd.index("-filter_complex") + 1]
    sidechain_stmt = next(
        s for s in fc.split(";") if "sidechaincompress" in s
    )
    # [m][0:a]sidechaincompress -> music (labeled [m]) is compressed,
    # keyed by input 0's audio (the video/narration track).
    assert sidechain_stmt.startswith("[m][0:a]sidechaincompress")


def test_mix_music_over_video_stream_order_is_input_zero(tmp_path: Path, capture, durations):
    video = tmp_path / "avatar.mp4"
    music = tmp_path / "music.mp3"
    out = tmp_path / "mixed.mp4"
    for p in (video, music):
        p.write_bytes(b"x")

    ffmpeg.mix_music_over(video, music, out)

    cmd = capture[0]
    assert cmd[cmd.index("-i") + 1] == str(video)
    # second -i is the music input
    second_i = cmd.index("-i", cmd.index("-i") + 1)
    assert cmd[second_i + 1] == str(music)


# --- extract_audio: no-audio guard -------------------------------------


def test_extract_audio_raises_when_no_audio_stream(tmp_path: Path, capture, has_audio):
    video = tmp_path / "silent.mp4"
    video.write_bytes(b"x")
    out = tmp_path / "vo.wav"
    has_audio[str(video)] = False

    with pytest.raises(ValueError, match="no audio stream"):
        ffmpeg.extract_audio(video, out)

    # must not have shelled out to ffmpeg at all
    assert capture == []


def test_extract_audio_runs_when_audio_present(tmp_path: Path, capture, has_audio):
    video = tmp_path / "avatar.mp4"
    video.write_bytes(b"x")
    out = tmp_path / "vo.wav"
    has_audio[str(video)] = True

    ffmpeg.extract_audio(video, out, sample_rate=16_000)

    assert len(capture) == 1
    cmd = capture[0]
    assert "-vn" in cmd
    assert "pcm_s16le" in cmd
    assert "16000" in cmd
    assert cmd[-1] == str(out)


# --- concat_clips: keep_audio requires audio on every input -------------


def test_concat_keep_audio_raises_when_any_clip_silent(tmp_path: Path, capture, has_audio):
    clips = [tmp_path / "a.mp4", tmp_path / "b.mp4", tmp_path / "c.mp4"]
    for c in clips:
        c.write_bytes(b"x")
    has_audio[str(clips[0])] = True
    has_audio[str(clips[1])] = False  # this one has no audio track
    has_audio[str(clips[2])] = True

    with pytest.raises(ValueError, match="keep_audio=True"):
        ffmpeg.concat_clips(clips, tmp_path / "out.mp4", keep_audio=True)

    assert capture == []


def test_concat_keep_audio_succeeds_when_all_have_audio(tmp_path: Path, capture, has_audio):
    clips = [tmp_path / "a.mp4", tmp_path / "b.mp4"]
    for c in clips:
        c.write_bytes(b"x")
        has_audio[str(c)] = True

    ffmpeg.concat_clips(clips, tmp_path / "out.mp4", keep_audio=True)

    assert len(capture) == 1
    cmd = capture[0]
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "concat=n=2:v=1:a=1[out][aout]" in fc
    assert "-c:a" in cmd and "aac" in cmd


def test_concat_no_audio_check_when_keep_audio_false(tmp_path: Path, capture, has_audio):
    """The guard is scoped to keep_audio=True — silent concat never probes."""
    clips = [tmp_path / "a.mp4", tmp_path / "b.mp4"]
    for c in clips:
        c.write_bytes(b"x")
    has_audio[str(clips[0])] = False
    has_audio[str(clips[1])] = False

    ffmpeg.concat_clips(clips, tmp_path / "out.mp4", keep_audio=False)

    assert len(capture) == 1  # did not raise


# --- video_qa: enforce_duration gate -------------------------------------


class _StubReencode:
    """No-op stand-in so upload-budget re-encode is never exercised here."""

    def __call__(self, *a, **kw):
        raise AssertionError("reencode_to_size should not be called in these tests")


def _make_render(tmp_path: Path, size: int = 200_000) -> Path:
    final = tmp_path / "final.mp4"
    final.write_bytes(b"x" * size)
    return final


def test_check_render_enforces_duration_by_default(tmp_path: Path, monkeypatch):
    final = _make_render(tmp_path)
    vo = tmp_path / "vo.wav"
    vo.write_bytes(b"x")

    monkeypatch.setattr(video_qa.ffmpeg, "probe_duration", lambda p: 10.0 if p == vo else 30.0)
    monkeypatch.setattr(video_qa.ffmpeg, "probe_has_audio", lambda p: True)
    monkeypatch.setattr(video_qa.ffmpeg, "measure_mean_volume_db", lambda p: -10.0)

    # target is 10s but real duration is 30s -> 200% drift, way over the
    # 35% tolerance; default enforce_duration=True must fail the render.
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=10)

    assert not report.passed
    assert any("off the" in issue for issue in report.issues)


def test_check_render_enforce_duration_false_skips_only_drift_gate(tmp_path: Path, monkeypatch):
    final = _make_render(tmp_path)
    vo = tmp_path / "vo.wav"
    vo.write_bytes(b"x")

    monkeypatch.setattr(video_qa.ffmpeg, "probe_duration", lambda p: 10.0 if p == vo else 30.0)
    monkeypatch.setattr(video_qa.ffmpeg, "probe_has_audio", lambda p: True)
    monkeypatch.setattr(video_qa.ffmpeg, "measure_mean_volume_db", lambda p: -10.0)

    report = video_qa.check_render(
        final, voiceover_path=vo, target_duration_sec=10, enforce_duration=False
    )

    # drift gate suppressed -> nothing else wrong -> passes
    assert report.passed
    assert report.issues == []
    assert report.duration_sec == 30.0


def test_check_render_enforce_duration_false_still_catches_other_gates(tmp_path: Path, monkeypatch):
    """enforce_duration=False must not become a blanket bypass — silence and
    missing-audio gates still fire."""
    final = _make_render(tmp_path)
    vo = tmp_path / "vo.wav"
    vo.write_bytes(b"x")

    monkeypatch.setattr(video_qa.ffmpeg, "probe_duration", lambda p: 10.0 if p == vo else 30.0)
    monkeypatch.setattr(video_qa.ffmpeg, "probe_has_audio", lambda p: False)  # no audio stream
    monkeypatch.setattr(video_qa.ffmpeg, "measure_mean_volume_db", lambda p: -10.0)

    report = video_qa.check_render(
        final, voiceover_path=vo, target_duration_sec=10, enforce_duration=False
    )

    assert not report.passed
    assert any("no audio stream" in issue for issue in report.issues)


def test_check_render_enforce_duration_false_still_catches_vo_coverage(tmp_path: Path, monkeypatch):
    final = _make_render(tmp_path)
    vo = tmp_path / "vo.wav"
    vo.write_bytes(b"x")

    # video (8s) ends well before the VO (30s) -> narration cut off
    monkeypatch.setattr(video_qa.ffmpeg, "probe_duration", lambda p: 30.0 if p == vo else 8.0)
    monkeypatch.setattr(video_qa.ffmpeg, "probe_has_audio", lambda p: True)
    monkeypatch.setattr(video_qa.ffmpeg, "measure_mean_volume_db", lambda p: -10.0)

    report = video_qa.check_render(
        final, voiceover_path=vo, target_duration_sec=10, enforce_duration=False
    )

    assert not report.passed
    assert any("cut off" in issue for issue in report.issues)
