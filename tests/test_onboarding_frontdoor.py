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

    captured: dict = {}

    async def fake_draft(description, *, brand_context="", spend=None):
        assert "economics" in description
        captured["spend"] = spend
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

    async def fake_ctx(**kw):
        captured["ctx_kw"] = kw
        return object()

    # The endpoint imports draft_niche lazily; patch at the agent module.
    import marketer.agents.niche_draft as nd
    import marketer.repos.brand_kit as bk
    import marketer.services.spend_context as sc

    async def _no_kit(uid):
        return None

    monkeypatch.setattr(nd, "draft_niche", fake_draft)
    monkeypatch.setattr(bk, "get", _no_kit)
    monkeypatch.setattr(sc, "default_context", fake_ctx)

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
    # Metered: spend context is built niche-less and handed to the agent.
    assert captured["spend"] is not None
    assert captured["ctx_kw"]["user_id"] == "user_a"
    assert captured["ctx_kw"]["niche_id"] is None
    # Every wizard-inferable field is present.
    for k in (
        "target_audience", "hashtags", "visual_style",
        "target_duration_sec", "scene_count", "image_quality",
        "scene_max_duration_sec", "tts_style_directions",
    ):
        assert k in body


def test_draft_402_when_spend_blocked(client, monkeypatch):
    """Onboarding draft is a paid LLM call — honor caps / prepaid credit."""
    from marketer.repos.spend import SpendCapExceeded
    import marketer.agents.niche_draft as nd
    import marketer.repos.brand_kit as bk
    import marketer.services.spend_context as sc

    called: list[str] = []

    async def _no_kit(uid):
        return None

    async def fake_ctx(**kw):
        return object()

    async def fake_draft(description, *, brand_context="", spend=None):
        called.append(description)
        raise SpendCapExceeded(
            "user user_a has $0 credit; call would charge $0.01. Top up to continue.",
            scope="credits",
        )

    monkeypatch.setattr(nd, "draft_niche", fake_draft)
    monkeypatch.setattr(bk, "get", _no_kit)
    monkeypatch.setattr(sc, "default_context", fake_ctx)

    resp = client.post(
        "/api/v1/niches/draft",
        json={"description": "claymation videos explaining economics for adults"},
        headers={"Authorization": "Bearer mkt_x"},
    )
    assert resp.status_code == 402
    assert "credit" in resp.json()["detail"]
    assert called  # agent ran far enough to refuse; route maps the error


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


async def test_account_summary_shape(monkeypatch):
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
    out = await metrics_route.metrics_summary(AuthCtx(user_id="user_a", email=""))
    assert out.total_views == 1234
    assert out.best_views == 900
    assert out.days == 30
