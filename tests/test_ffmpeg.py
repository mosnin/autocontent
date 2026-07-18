from __future__ import annotations

from pathlib import Path

import pytest

from marketer.services import ffmpeg


@pytest.fixture
def capture(monkeypatch):
    calls: list[list[str]] = []

    def _fake_run(cmd: list[str]) -> None:
        calls.append(cmd)

    monkeypatch.setattr(ffmpeg, "_run", _fake_run)
    return calls


def test_concat_builds_scale_pad_chain_per_input(tmp_path: Path, capture):
    clips = [tmp_path / "a.mp4", tmp_path / "b.mp4", tmp_path / "c.mp4"]
    for c in clips:
        c.write_bytes(b"x")
    out = tmp_path / "silent.mp4"

    ffmpeg.concat_clips(clips, out, aspect="9:16")

    assert len(capture) == 1
    cmd = capture[0]
    assert cmd[0] == "ffmpeg"
    # one -i per clip
    assert cmd.count("-i") == 3
    fc_idx = cmd.index("-filter_complex")
    filter_complex = cmd[fc_idx + 1]
    assert filter_complex.count("scale=1080:1920") == 3
    assert "concat=n=3:v=1:a=0[out]" in filter_complex
    assert "-an" in cmd
    assert cmd[-1] == str(out)


def test_concat_empty_raises(tmp_path: Path, capture):
    with pytest.raises(ValueError):
        ffmpeg.concat_clips([], tmp_path / "out.mp4")


def test_concat_unknown_aspect(tmp_path: Path, capture):
    clip = tmp_path / "a.mp4"
    clip.write_bytes(b"x")
    with pytest.raises(ValueError):
        ffmpeg.concat_clips([clip], tmp_path / "out.mp4", aspect="3:2")


@pytest.fixture
def durations(monkeypatch):
    """Stub probe_duration with a per-path mapping (falls back to 10s)."""
    table: dict[str, float] = {}
    monkeypatch.setattr(
        ffmpeg, "probe_duration", lambda p: table.get(str(p), 10.0)
    )
    return table


def test_mix_audio_uses_sidechain_and_gain(tmp_path: Path, capture, durations):
    video = tmp_path / "silent.mp4"
    vo = tmp_path / "vo.wav"
    music = tmp_path / "m.mp3"
    out = tmp_path / "mixed.mp4"
    for p in (video, vo, music):
        p.write_bytes(b"x")

    ffmpeg.mix_audio(video, vo, music, out, music_gain_db=-20.0)

    cmd = capture[0]
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "volume=-20.0dB" in fc
    assert "sidechaincompress" in fc
    assert "amix=inputs=2" in fc
    assert "-map" in cmd and "0:v" in cmd
    assert "[a]" in cmd  # mapped output audio label
    # equal durations -> no tpad, video stream-copied
    assert "tpad" not in fc
    assert "copy" in cmd


def test_mix_audio_pads_video_when_vo_longer(tmp_path: Path, capture, durations):
    video = tmp_path / "silent.mp4"
    vo = tmp_path / "vo.wav"
    out = tmp_path / "mixed.mp4"
    for p in (video, vo):
        p.write_bytes(b"x")
    durations[str(video)] = 18.0
    durations[str(vo)] = 21.5  # VO outruns clips by 3.5s

    ffmpeg.mix_audio(video, vo, None, out)

    cmd = capture[0]
    fc = cmd[cmd.index("-filter_complex") + 1]
    # 3.5s gap + VO_TAIL_SEC breathing room, last frame cloned
    assert f"tpad=stop_mode=clone:stop_duration={3.5 + ffmpeg.VO_TAIL_SEC:.3f}" in fc
    assert "[v]" in cmd  # padded stream is the one mapped
    assert "libx264" in cmd  # tpad forces re-encode
    assert "copy" not in cmd


def test_mix_audio_no_pad_when_video_longer(tmp_path: Path, capture, durations):
    video = tmp_path / "silent.mp4"
    vo = tmp_path / "vo.wav"
    out = tmp_path / "mixed.mp4"
    for p in (video, vo):
        p.write_bytes(b"x")
    durations[str(video)] = 22.0
    durations[str(vo)] = 20.0

    ffmpeg.mix_audio(video, vo, None, out)

    cmd = capture[0]
    assert "-filter_complex" not in cmd
    assert "copy" in cmd


def test_reencode_to_size_computes_bitrate(tmp_path: Path, capture, durations):
    video = tmp_path / "final.mp4"
    video.write_bytes(b"x" * 100)
    out = tmp_path / "final_fit.mp4"
    durations[str(video)] = 60.0

    ffmpeg.reencode_to_size(video, out, max_bytes=30 * 1024 * 1024)

    # two-pass: analysis pass to null, encode pass to the real output
    assert len(capture) == 2
    pass1, pass2 = capture
    assert "1" == pass1[pass1.index("-pass") + 1]
    assert pass1[-1] == "/dev/null"
    assert "2" == pass2[pass2.index("-pass") + 1]
    assert pass2[-1] == str(out)

    bv = pass2[pass2.index("-b:v") + 1]
    kbps = int(bv.rstrip("k"))
    # 30MB over 60s ≈ 4194kbps raw; minus margin + audio → sane h264 range
    assert 3000 < kbps < 4200
    assert "-maxrate" in pass2 and "-movflags" in pass2


def test_reencode_to_size_rejects_unwatchable_budget(tmp_path: Path, capture, durations):
    video = tmp_path / "final.mp4"
    video.write_bytes(b"x")
    durations[str(video)] = 600.0  # 10 min into 3MB -> mush

    with pytest.raises(ValueError):
        ffmpeg.reencode_to_size(video, tmp_path / "out.mp4", max_bytes=3 * 1024 * 1024)


def test_burn_subtitles_uses_ass_filter(tmp_path: Path, capture):
    video = tmp_path / "mixed.mp4"
    ass = tmp_path / "subs.ass"
    out = tmp_path / "final.mp4"
    for p in (video, ass):
        p.write_bytes(b"x")

    ffmpeg.burn_subtitles(video, ass, out)

    cmd = capture[0]
    vf_idx = cmd.index("-vf")
    assert cmd[vf_idx + 1] == f"ass={ass}"
    assert cmd[-1] == str(out)
