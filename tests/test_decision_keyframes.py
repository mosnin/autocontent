"""Point 9 (video): keyframes and the garbled on-screen text check."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess

import httpx
import pytest

from marketer.decisions import keyframes as kf
from marketer.decisions import points
from marketer.decisions import questions as q
from marketer.decisions import tables
from marketer.models import Idea, Scene, Script
from marketer.repos import decision_log as decision_log_repo
from marketer.repos import feature_flags as flags_repo
from marketer.services import decisions as svc

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 32
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


# ---------------------------------------------------------------------------
# Frame sizes and parts
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "size, want",
    [
        ((1080, 1920), (576, 1024)),   # 9:16
        ((1920, 1080), (1024, 576)),   # 16:9
        ((1080, 1080), (1024, 1024)),  # 1:1
        ((320, 240), (1024, 768)),     # small sources are scaled up into the window
        ((4000, 500), None),           # 8:1: the short side would fall under the minimum
        ((0, 100), None),
    ],
)
def test_target_size_stays_inside_the_models_window(size, want):
    got = kf.target_size(*size)
    assert got == want
    if got:
        w, h = got
        assert kf.MIN_SIDE <= min(w, h) and max(w, h) <= kf.MAX_SIDE
        assert kf.MIN_PIXELS <= w * h <= kf.MAX_PIXELS


def test_image_parts_are_data_urls_and_drop_other_formats():
    parts = kf.image_parts([JPEG, b"GIF89a....", PNG, JPEG, JPEG])
    assert len(parts) == 2  # capped at MAX_FRAMES inputs, the GIF dropped
    assert parts[0] == {"type": "image_url", "image_url": {
        "url": "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()}}
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert kf.image_parts(None) == []


def test_sampling_an_unreadable_file_yields_no_frames(tmp_path):
    assert kf.sample(tmp_path / "missing.mp4") == []


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_sampling_a_real_video_yields_jpegs_in_the_window(tmp_path):
    video = tmp_path / "v.mp4"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i",
         "testsrc=duration=2:size=540x960:rate=10", "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )
    frames = kf.sample(video)
    assert len(frames) == 3 and all(f.startswith(b"\xff\xd8") for f in frames)
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
         "-of", "csv=p=0", "-f", "image2pipe", "-i", "-"],
        input=frames[0], capture_output=True, check=True,
    ).stdout.decode().strip()
    assert out == "576,1024"


# ---------------------------------------------------------------------------
# verify_video with frames
# ---------------------------------------------------------------------------


def test_the_check_is_only_asked_when_there_are_frames():
    assert "garbled_text" not in q.video_checks([])
    checks = q.video_checks(["no medical claims"], has_keyframes=True)
    assert checks["garbled_text"].pass_when == "no"
    assert "`keyframes`" in checks["garbled_text"].question.instructions


def test_garbled_text_bounces_alone_and_is_never_averaged():
    checks = q.video_checks([], has_keyframes=True)
    clean = {name: {"type": "yesno", "probability": 0.97} for name in q.VIDEO_CHECKS_V1}
    ok = tables.verify({**clean, "garbled_text": {"type": "yesno", "probability": 0.05}},
                       checks, grounded_asked=False)
    assert ok.passed
    bad = tables.verify({**clean, "garbled_text": {"type": "yesno", "probability": 0.4}},
                        checks, grounded_asked=False)
    assert not bad.passed and bad.failures == ["garbled_text"]


def _script() -> Script:
    idea = Idea(topic="t", angle="a", hook="Stop wasting $40 a month", target_audience="x",
                why_it_works="y")
    return Script(idea=idea, scenes=[Scene(index=0, narration="n", visual_prompt="v", motion_prompt="m",
                                           duration_sec=3)], total_duration_sec=3)


@pytest.fixture
def model(monkeypatch):
    """Decisions on, QA video in the given mode, answering from `garbled`."""

    class M:
        calls: list[dict] = []
        garbled = 0.02
        status = 200

    m = M()
    m.calls = []
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-test-key")

    async def no_flags():
        return []

    async def insert(**kw):
        return None

    monkeypatch.setattr(flags_repo, "list_all", no_flags)
    monkeypatch.setattr(decision_log_repo, "insert", insert)

    async def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        m.calls.append(body)
        if m.status != 200:
            return httpx.Response(m.status, json={"error": {"code": m.status, "message": "x"}})
        answers = {
            name: {"type": "noul", "noul": m.garbled if name == "garbled_text" else 0.97}
            for name in body["questions"]
        }
        return httpx.Response(200, json={
            "answers": answers, "model": body["model"],
            "usage": {"cost": 0.00003, "input_tokens": 700, "output_tokens": 30}})

    real = svc.DecisionClient
    monkeypatch.setattr(svc, "DecisionClient",
                        lambda: real(key="k", transport=httpx.MockTransport(handle)))
    m.mode = lambda mode: monkeypatch.setenv("MARKETER_DECISION_QA_VIDEO_MODE", mode)
    return m


async def _verify(**kw):
    return await points.verify_video(script=_script(), transcript="n", niche_title="niche",
                                     brand_rules=[], rule_passed=True, **kw)


async def test_frames_travel_as_image_parts_and_add_one_question(model):
    model.mode("enforce")
    assert await _verify(keyframes=[JPEG, PNG]) is None  # clean frames: no bounce
    sent = model.calls[0]
    assert [p["type"] for p in sent["state"]["keyframes"]] == ["image_url", "image_url"]
    assert sent["questions"]["garbled_text"]["type"] == "noul"
    assert sent["model"] == q.D1_MODEL  # images only ever go to the model that reads them


async def test_enforce_bounces_garbled_text_and_shadow_does_not(model):
    model.garbled = 0.8
    model.mode("enforce")
    assert await _verify(keyframes=[JPEG]) == ["garbled_text"]
    model.mode("shadow")
    assert await _verify(keyframes=[JPEG]) is None


async def test_no_frames_means_today_s_text_only_verify(model):
    model.mode("enforce")
    assert await _verify() is None
    assert await _verify(keyframes=[b"not an image"]) is None
    for sent in model.calls:
        assert "keyframes" not in sent["state"] and "garbled_text" not in sent["questions"]


async def test_a_failed_call_with_frames_is_never_a_bounce(model):
    model.mode("enforce")
    model.status = 400  # e.g. the model rejects the image
    assert await _verify(keyframes=[JPEG]) is None


async def test_kill_switch_drops_the_image_check_only(model, monkeypatch):
    model.mode("enforce")
    monkeypatch.setenv("MARKETER_DECISIONS_KEYFRAMES", "off")
    assert await _verify(keyframes=[JPEG]) is None
    assert "keyframes" not in model.calls[0]["state"]
    assert "takeaway_match" in model.calls[0]["questions"]


async def test_off_never_samples_the_video(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("must not sample when the point is off")

    monkeypatch.setattr(kf, "sample_async", boom)
    assert await _verify(video_path="/tmp/whatever.mp4") is None  # no key: off


async def test_video_path_is_sampled_when_the_point_is_on(model, monkeypatch):
    model.mode("shadow")

    async def frames(path, **k):
        assert path == "/renders/final.mp4"
        return [JPEG, JPEG, JPEG]

    monkeypatch.setattr(kf, "sample_async", frames)
    await _verify(video_path="/renders/final.mp4")
    assert len(model.calls[0]["state"]["keyframes"]) == 3
