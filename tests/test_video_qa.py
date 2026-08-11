from __future__ import annotations

from pathlib import Path

import pytest

from marketer.services import ffmpeg, video_qa

BODY = b"x" * (video_qa.MIN_FILE_BYTES + 1)


@pytest.fixture
def media(tmp_path: Path, monkeypatch):
    """A healthy render: 30s video w/ audio at -20dB, 29s VO, small file."""
    final = tmp_path / "final.mp4"
    vo = tmp_path / "vo.wav"
    final.write_bytes(BODY)
    vo.write_bytes(BODY)

    durations = {str(final): 30.0, str(vo): 29.0}
    state = {"has_audio": True, "mean_db": -20.0, "durations": durations}

    monkeypatch.setattr(ffmpeg, "probe_duration", lambda p: state["durations"][str(p)])
    monkeypatch.setattr(ffmpeg, "probe_has_audio", lambda p: state["has_audio"])
    monkeypatch.setattr(ffmpeg, "measure_mean_volume_db", lambda p: state["mean_db"])
    return final, vo, state


def test_healthy_render_passes(media):
    final, vo, _ = media
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert report.passed
    assert report.issues == []
    assert report.duration_sec == 30.0
    assert report.final_path == str(final)


def test_missing_file_fails(tmp_path: Path):
    report = video_qa.check_render(
        tmp_path / "nope.mp4", voiceover_path=tmp_path / "vo.wav", target_duration_sec=30
    )
    assert not report.passed
    assert "missing or truncated" in report.issues[0]


def test_truncated_file_fails(media):
    final, vo, _ = media
    final.write_bytes(b"tiny")
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert not report.passed
    assert "missing or truncated" in report.issues[0]


def test_vo_cut_off_fails(media):
    final, vo, state = media
    state["durations"][str(vo)] = 33.0  # narration outruns the video
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert not report.passed
    assert any("cut off" in i for i in report.issues)


def test_silent_audio_fails(media):
    final, vo, state = media
    state["mean_db"] = -60.0
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert not report.passed
    assert any("silent" in i for i in report.issues)


def test_no_audio_stream_fails(media):
    final, vo, state = media
    state["has_audio"] = False
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert not report.passed
    assert any("no audio stream" in i for i in report.issues)


def test_duration_drift_fails(media):
    final, vo, state = media
    state["durations"][str(final)] = 55.0  # 83% over a 30s target
    state["durations"][str(vo)] = 50.0
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert not report.passed
    assert any("off the 30s target" in i for i in report.issues)


def test_oversize_file_reencoded_and_passes(media, monkeypatch):
    final, vo, state = media
    big = video_qa.MAX_UPLOAD_BYTES + 1
    final.write_bytes(b"x" * (video_qa.MIN_FILE_BYTES + 1))
    monkeypatch.setattr(
        Path, "stat", _fake_stat_factory({str(final): big}), raising=False
    )

    fitted_holder = {}

    def _fake_reencode(src: Path, dst: Path, *, max_bytes: int) -> Path:
        dst.write_bytes(BODY)
        fitted_holder["path"] = dst
        # after re-encode the fitted file reports a small size
        monkeypatch.setattr(
            Path,
            "stat",
            _fake_stat_factory({str(final): big, str(dst): 10 * 1024 * 1024}),
            raising=False,
        )
        return dst

    monkeypatch.setattr(ffmpeg, "reencode_to_size", _fake_reencode)

    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert report.passed
    assert report.final_path == str(fitted_holder["path"])
    assert report.size_bytes == 10 * 1024 * 1024


def test_oversize_file_failing_reencode_fails(media, monkeypatch):
    final, vo, _ = media
    big = video_qa.MAX_UPLOAD_BYTES + 1
    monkeypatch.setattr(
        Path, "stat", _fake_stat_factory({str(final): big}), raising=False
    )
    monkeypatch.setattr(
        ffmpeg,
        "reencode_to_size",
        lambda *a, **k: (_ for _ in ()).throw(ValueError("budget too low")),
    )
    report = video_qa.check_render(final, voiceover_path=vo, target_duration_sec=30)
    assert not report.passed
    assert any("exceeds upload limit" in i for i in report.issues)


def _fake_stat_factory(sizes: dict[str, int]):
    """Path.stat replacement that lies about st_size for chosen paths."""
    real_stat = Path.stat

    def _stat(self: Path, **kwargs):
        result = real_stat(self, **kwargs)
        if str(self) in sizes:
            class _S:
                st_size = sizes[str(self)]

                def __getattr__(self, name):
                    return getattr(result, name)

            return _S()
        return result

    return _stat
