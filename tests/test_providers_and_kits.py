"""Fal video, OpenRouter scriptwriter, subject-mode, and kits (units).

External calls mocked; real-PG kit coverage lives in
tests/integration/test_pg_kits.py.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from marketer.config import settings
from marketer.services import fal_video, openrouter

# --------------------------------------------------------------------------- fal


def test_fal_disabled_without_key():
    assert not fal_video.enabled()


async def test_fal_animate_refuses_when_disabled(tmp_path: Path):
    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    with pytest.raises(fal_video.FalVideoError, match="FAL_API_KEY"):
        await fal_video.animate(
            kf, "pan", tmp_path / "out.mp4",
            model_id=fal_video.FAL_VIDEO_MODELS[0].id,
        )


async def test_fal_animate_unknown_model(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    with pytest.raises(fal_video.FalVideoError, match="unknown fal model"):
        await fal_video.animate(kf, "pan", tmp_path / "out.mp4", model_id="nope/nope")


def test_fal_cost_math():
    model = fal_video.get_model("fal-ai/kling-video/v2.1/standard/image-to-video")
    assert fal_video.video_cost(model, 5) == Decimal("0.2500")


async def test_fal_animate_full_flow_mocked(tmp_path: Path, monkeypatch, fake_spend):
    """Submit -> poll -> fetch result -> download, with spend logged
    against the model's registry price."""
    monkeypatch.setattr(settings, "fal_api_key", "fal-test")
    model = fal_video.FAL_VIDEO_MODELS[0]

    class _Resp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class _Stream:
        def __init__(self):
            self.headers = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def raise_for_status(self):
            return None

        async def aiter_bytes(self):
            yield b"MP4DATA"

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            assert url.endswith(model.id)
            assert json["duration"] == "5"
            assert json["image_url"].startswith("data:image/png;base64,")
            return _Resp({
                "request_id": "r1",
                "status_url": "https://queue.fal.run/r1/status",
                "response_url": "https://queue.fal.run/r1/response",
            })

        async def get(self, url):
            if url.endswith("/status"):
                return _Resp({"status": "COMPLETED"})
            return _Resp({"video": {"url": "https://cdn.fal/video.mp4"}})

        def stream(self, method, url):
            return _Stream()

    monkeypatch.setattr(fal_video, "_client", lambda: _Client())

    kf = tmp_path / "kf.png"
    kf.write_bytes(b"PNG")
    out = tmp_path / "out.mp4"
    ctx, rec = fake_spend

    result = await fal_video.animate(
        kf, "gentle pan", out, model_id=model.id, duration_sec=5.0, spend=ctx,
    )
    assert result == out and out.read_bytes() == b"MP4DATA"
    assert len(rec.entries) == 1
    entry = rec.entries[0]
    assert entry.provider == "fal"
    assert entry.sku == model.id
    assert entry.cost_usd == Decimal("0.2500")


# --------------------------------------------------------------------------- openrouter


def test_openrouter_cost_math():
    m = openrouter.get_model("deepseek/deepseek-chat-v3.1")
    # 1M in + 1M out at listed prices
    assert openrouter.llm_cost(m, 1_000_000, 1_000_000) == Decimal("1.370000")


def test_openrouter_agents_model_requires_key():
    with pytest.raises(RuntimeError):
        openrouter.agents_model("anthropic/claude-sonnet-4.5")


async def test_scriptwriter_uses_openrouter_when_configured(monkeypatch, fake_spend):
    """script_model set + key present -> agent runs the OpenRouter model
    and spend is logged with that provider/sku and registry pricing."""
    import marketer.orchestrator as _orch
    from agents import Runner
    from marketer.models import Idea, Scene, Script

    monkeypatch.setattr(settings, "openrouter_api_key", "or-test")
    script = Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x",
                  why_it_works="y"),
        scenes=[Scene(index=0, narration="n", visual_prompt="v",
                      motion_prompt="m", duration_sec=5)],
        total_duration_sec=5,
    )
    seen = {}

    class _Result:
        def __init__(self):
            self.context_wrapper = type("W", (), {"usage": type(
                "U", (), {"total_tokens": 3000,
                          "input_tokens": 2000, "output_tokens": 1000})()})()

        def final_output_as(self, cls):
            return script

    async def fake_run(agent, *, input):  # noqa: A002
        seen["model"] = agent.model
        return _Result()

    monkeypatch.setattr(Runner, "run", fake_run)

    ctx, rec = fake_spend
    await _orch.run_scriptwriter(
        script.idea, scene_count=1, target_duration_sec=5,
        script_model="deepseek/deepseek-chat-v3.1", spend=ctx,
    )
    # a model object (not the stock string) was installed on the agent
    assert not isinstance(seen["model"], str)
    entry = rec.entries[0]
    assert entry.provider == "openrouter"
    assert entry.sku == "llm:deepseek/deepseek-chat-v3.1"
    m = openrouter.get_model("deepseek/deepseek-chat-v3.1")
    assert entry.cost_usd == openrouter.llm_cost(m, 2000, 1000)


async def test_scriptwriter_falls_back_when_openrouter_unconfigured(
    monkeypatch, fake_spend
):
    import marketer.orchestrator as _orch
    from agents import Runner
    from marketer.models import Idea, Scene, Script

    script = Script(
        idea=Idea(topic="t", angle="a", hook="h", target_audience="x",
                  why_it_works="y"),
        scenes=[Scene(index=0, narration="n", visual_prompt="v",
                      motion_prompt="m", duration_sec=5)],
        total_duration_sec=5,
    )
    seen = {}

    class _Result:
        def __init__(self):
            self.context_wrapper = type("W", (), {"usage": type(
                "U", (), {"total_tokens": 10, "input_tokens": 5,
                          "output_tokens": 5})()})()

        def final_output_as(self, cls):
            return script

    async def fake_run(agent, *, input):  # noqa: A002
        seen["model"] = agent.model
        return _Result()

    monkeypatch.setattr(Runner, "run", fake_run)
    ctx, rec = fake_spend
    # key NOT set — must silently fall back to the stock model
    await _orch.run_scriptwriter(
        script.idea, scene_count=1, target_duration_sec=5,
        script_model="deepseek/deepseek-chat-v3.1", spend=ctx,
    )
    assert seen["model"] == settings.agent_model
    assert rec.entries[0].provider == "openai"


# --------------------------------------------------------------------------- subject mode


def test_cast_mode_none_in_vd_brief():
    from marketer.models import CreativeBrief

    brief = CreativeBrief.model_validate({"visual": {"cast_mode": "none"}})
    assert brief.visual_director_brief() == {"cast_mode": "none"}


# --------------------------------------------------------------------------- ad kit knobs


def test_ad_kit_knobs_shape_proposals():
    from marketer.services.ad_workflows import _kit_knobs

    knobs = _kit_knobs({
        "target_roas": 3, "scale_up_pct": 50,
        "max_daily_budget_usd": 100, "junk_key": "ignored",
        "scale_down_pct": "not-a-number",
    })
    assert knobs["target_roas"] == Decimal("3")
    assert knobs["scale_up_pct"] == Decimal("50")
    assert knobs["max_daily_budget_usd"] == Decimal("100")
    assert "scale_down_pct" not in knobs  # bad value ignored
    assert "junk_key" not in knobs
