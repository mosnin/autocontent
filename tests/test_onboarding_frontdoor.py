"""One-sentence onboarding: draft endpoint + agent contract."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.auth import AuthCtx, require_user
from backend.main import create_app
from backend.rate_limit import limiter


@pytest.fixture()
def client():
    limiter.reset()
    app = create_app()
    app.dependency_overrides[require_user] = lambda: AuthCtx(
        user_id="user_a", email="a@a"
    )
    return TestClient(app)


def test_draft_rejects_too_short(client):
    resp = client.post(
        "/api/v1/niches/draft",
        json={"description": "hi"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 422


def test_draft_returns_full_spec(client, monkeypatch):
    from marketer.agents.niche_draft import NicheDraft

    async def fake_draft(description, *, brand_context="", spend=None):
        assert "economics" in description
        return NicheDraft(
            title="Clay Economics",
            description="Claymation explainers on economics.",
            target_audience="curious adults new to econ",
            hashtags=["econ", "claymation", "learn"],
            visual_style="claymation, warm lighting, tactile",
            voice="onyx",
            target_duration_sec=45,
            scene_count=5,
            image_quality="high",
            video_resolution="720p",
            scene_max_duration_sec=6,
            tts_style_directions="calm and warm",
        )

    # The endpoint imports draft_niche lazily; patch at the agent module.
    import marketer.agents.niche_draft as nd
    import marketer.repos.brand_kit as bk

    async def _no_kit(uid):
        return None

    monkeypatch.setattr(nd, "draft_niche", fake_draft)
    monkeypatch.setattr(bk, "get", _no_kit)

    resp = client.post(
        "/api/v1/niches/draft",
        json={"description": "claymation videos explaining economics for adults"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Clay Economics"
    assert body["voice"] == "onyx"
    assert body["video_resolution"] == "720p"
    # Every wizard-inferable field is present.
    for k in (
        "target_audience", "hashtags", "visual_style",
        "target_duration_sec", "scene_count", "image_quality",
        "scene_max_duration_sec", "tts_style_directions",
    ):
        assert k in body


def test_draft_spec_voice_is_constrained():
    """The draft model must only emit voices the TTS layer supports."""
    from marketer.agents.niche_draft import NicheDraft

    with pytest.raises(Exception):
        NicheDraft(
            title="x",
            description="x",
            target_audience="x",
            visual_style="x",
            voice="darthvader",  # not a supported voice
            target_duration_sec=45,
            scene_count=5,
        )


def test_template_niche_drafts_are_reviewable():
    from marketer.agents.niche_draft import NicheDraft, parse_brand_context, template_niche_drafts

    drafts = template_niche_drafts(
        "claymation videos explaining economics for curious adults"
    )
    assert len(drafts) >= 2
    assert all(isinstance(d, NicheDraft) for d in drafts)
    assert all(d.voice in {
        "alloy", "echo", "fable", "onyx", "nova", "shimmer", "ash", "sage", "coral",
    } for d in drafts)
    assert any("clay" in d.visual_style.casefold() for d in drafts)
    kit = parse_brand_context(
        "Brand kit (match this identity):\n"
        "- Brand: Clay Lab\n"
        "- Core audience: night-shift baristas\n"
        "- Preferred hashtags: espresso, craft\n"
        "- Tone of voice: calm and conspiratorial\n"
    )
    assert kit["brand"] == "Clay Lab"
    branded = template_niche_drafts(
        "espresso explainers for home baristas",
        brand_context=(
            "Brand kit (match this identity):\n"
            "- Core audience: night-shift baristas\n"
            "- Preferred hashtags: espresso, craft\n"
            "- Tone of voice: calm and conspiratorial\n"
        ),
    )
    assert branded[0].target_audience == "night-shift baristas"
    assert "espresso" in branded[0].hashtags
    assert branded[0].tts_style_directions == "calm and conspiratorial"


async def test_draft_niche_dark_path_is_first_template(monkeypatch):
    from marketer.agents import niche_draft as nd
    from marketer.config import settings

    monkeypatch.setattr(settings, "jev_enabled", False)
    draft = await nd.draft_niche("claymation videos explaining economics for adults")
    expected = nd.template_niche_drafts(
        "claymation videos explaining economics for adults"
    )[0]
    assert draft.title == expected.title
    assert draft.voice == expected.voice


def test_account_summary_shape(client, monkeypatch):
    """metrics_summary maps the repo aggregate into the response model."""
    from backend.routes import metrics as metrics_route

    async def fake_summary(user_id, *, days):
        return {
            "total_views": 1234,
            "sampled_videos": 3,
            "best_job_id": "job-1",
            "best_views": 900,
            "days": days,
        }

    monkeypatch.setattr(
        metrics_route.post_metrics_repo, "account_summary", fake_summary
    )
    resp = client.get(
        "/api/v1/metrics/summary",
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 200
    out = resp.json()
    assert out["total_views"] == 1234
    assert out["best_views"] == 900
    assert out["days"] == 30
