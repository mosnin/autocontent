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


def test_mix_audio_uses_sidechain_and_gain(tmp_path: Path, capture):
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
