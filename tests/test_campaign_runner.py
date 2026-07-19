"""Campaign runner units: window/budget gates, cadence pacing, platform
rotation. Repos mocked; real-PG coverage in tests/integration/test_pg_campaigns.py."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from marketer.models import Campaign, CampaignItem, Niche, PostingWindow
from marketer.repos import campaigns as campaigns_repo
from marketer.repos import niches as niches_repo
from marketer.services import campaign_runner

USER = "user_camp"
NOW = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)


def _campaign(**over) -> Campaign:
    base = dict(
        id=uuid4(), user_id=USER, name="launch", status="running",
        starts_at=NOW - timedelta(days=1), ends_at=None,
        budget_usd=Decimal("50"),
    )
    base.update(over)
    return Campaign(**base)


def _niche(niche_id, platforms=("tiktok", "reels")) -> Niche:
    return Niche(
        id=niche_id, user_id=USER, title="t", description="d",
        target_audience="a", visual_style="v", voice="onyx",
        target_duration_sec=30, scene_count=2,
        posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
        platforms=list(platforms), daily_spend_cap_usd=Decimal("5"),
    )


@pytest.fixture
def env(monkeypatch):
    state = {
        "campaign": _campaign(),
        "spent": Decimal("0"),
        "items": [],
        "counts": {"video": {}, "article": {}},
        "status_calls": [],
        "videos": [],
        "articles": [],
        "niches": {},
    }

    async def fake_spent(cid, *, user_id):
        return state["spent"]

    async def fake_items(cid, *, user_id):
        return state["items"]

    async def fake_counts(cid, *, user_id):
        return state["counts"]

    async def fake_status(cid, *, user_id, status):
        state["status_calls"].append(status)
        return state["campaign"].model_copy(update={"status": status})

    async def fake_niche_get(nid, *, user_id):
        return state["niches"].get(nid)

    monkeypatch.setattr(campaigns_repo, "spent_usd", fake_spent)
    monkeypatch.setattr(campaigns_repo, "list_items", fake_items)
    monkeypatch.setattr(campaigns_repo, "work_counts", fake_counts)
    monkeypatch.setattr(campaigns_repo, "set_status", fake_status)
    monkeypatch.setattr(niches_repo, "get", fake_niche_get)

    async def spawn_video(uid, nid, platform, cid):
        state["videos"].append((nid, platform))

    async def spawn_article(uid, nid, cid):
        state["articles"].append(nid)

    state["spawn_video"] = spawn_video
    state["spawn_article"] = spawn_article
    return state


async def _tick(state):
    return await campaign_runner.run_campaign_tick(
        state["campaign"],
        spawn_video=state["spawn_video"],
        spawn_article=state["spawn_article"],
        now=NOW,
    )


async def test_window_end_completes_without_spawning(env):
    env["campaign"] = _campaign(ends_at=NOW - timedelta(hours=1))
    result = await _tick(env)
    assert result["action"] == "completed" and "window" in result["reason"]
    assert env["status_calls"] == ["completed"]
    assert env["videos"] == [] and env["articles"] == []


async def test_budget_exhaustion_completes(env):
    env["spent"] = Decimal("50")  # == budget
    result = await _tick(env)
    assert result["action"] == "completed" and "budget" in result["reason"]
    assert env["status_calls"] == ["completed"]


async def test_due_lanes_spawn_video_and_article(env):
    vid_niche, art_niche = uuid4(), uuid4()
    env["niches"][vid_niche] = _niche(vid_niche)
    env["niches"][art_niche] = _niche(art_niche)
    env["items"] = [
        CampaignItem(id=uuid4(), campaign_id=env["campaign"].id, user_id=USER,
                     kind="video", ref_id=vid_niche, cadence_per_week=7),
        CampaignItem(id=uuid4(), campaign_id=env["campaign"].id, user_id=USER,
                     kind="article", ref_id=art_niche, cadence_per_week=3),
    ]
    result = await _tick(env)
    assert result["action"] == "ticked"
    assert env["videos"] == [(vid_niche, "tiktok")]  # first platform
    assert env["articles"] == [art_niche]


async def test_weekly_quota_is_a_hard_stop(env):
    nid = uuid4()
    env["niches"][nid] = _niche(nid)
    env["items"] = [CampaignItem(
        id=uuid4(), campaign_id=env["campaign"].id, user_id=USER,
        kind="video", ref_id=nid, cadence_per_week=3,
    )]
    env["counts"]["video"][nid] = {"total": 3, "last7": 3, "last_at": NOW - timedelta(days=3)}
    result = await _tick(env)
    assert env["videos"] == []
    assert result["spawned"] == []


async def test_spacing_prevents_frontloading(env):
    """Under quota but too soon after the last spawn -> wait."""
    nid = uuid4()
    env["niches"][nid] = _niche(nid)
    env["items"] = [CampaignItem(
        id=uuid4(), campaign_id=env["campaign"].id, user_id=USER,
        kind="video", ref_id=nid, cadence_per_week=7,  # every 24h
    )]
    env["counts"]["video"][nid] = {"total": 1, "last7": 1,
                                   "last_at": NOW - timedelta(hours=2)}
    await _tick(env)
    assert env["videos"] == []

    env["counts"]["video"][nid]["last_at"] = NOW - timedelta(hours=25)
    await _tick(env)
    assert len(env["videos"]) == 1


async def test_platform_rotation(env):
    nid = uuid4()
    env["niches"][nid] = _niche(nid, platforms=("tiktok", "reels", "shorts"))
    env["items"] = [CampaignItem(
        id=uuid4(), campaign_id=env["campaign"].id, user_id=USER,
        kind="video", ref_id=nid, cadence_per_week=56,
    )]
    env["counts"]["video"][nid] = {"total": 4, "last7": 1,
                                   "last_at": NOW - timedelta(hours=100)}
    await _tick(env)
    # 4 prior spawns -> index 4 % 3 == 1 -> 'reels'
    assert env["videos"] == [(nid, "reels")]


async def test_disabled_lane_skipped(env):
    nid = uuid4()
    env["niches"][nid] = _niche(nid)
    env["items"] = [CampaignItem(
        id=uuid4(), campaign_id=env["campaign"].id, user_id=USER,
        kind="video", ref_id=nid, enabled=False,
    )]
    await _tick(env)
    assert env["videos"] == []


async def test_tick_all_contains_per_campaign_failures(monkeypatch, env):
    boom = _campaign()
    ok = _campaign()

    async def fake_running():
        return [boom, ok]

    calls = {"n": 0}
    orig = campaign_runner.run_campaign_tick

    async def flaky(campaign, **kwargs):
        calls["n"] += 1
        if campaign.id == boom.id:
            raise RuntimeError("db hiccup")
        return {"campaign_id": str(campaign.id), "action": "ticked"}

    monkeypatch.setattr(campaigns_repo, "list_running", fake_running)
    monkeypatch.setattr(campaign_runner, "run_campaign_tick", flaky)
    try:
        result = await campaign_runner.tick_all()
    finally:
        campaign_runner.run_campaign_tick = orig
    assert calls["n"] == 2
    assert result["errors"] == 1 and result["campaigns"] == 1
