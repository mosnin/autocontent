"""Regression tests for the PR #42 audit findings (round 2)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.config import settings

_USER_ID = "user_test"


def _make_authed_client(monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")

    from backend.auth import AuthCtx, require_user

    async def _fake_require_user():
        return AuthCtx(user_id=_USER_ID, email="t@t.com")

    from backend.main import create_app
    app = create_app()
    app.dependency_overrides[require_user] = _fake_require_user
    return TestClient(app, raise_server_exceptions=False)


def _make_admin_client(monkeypatch) -> TestClient:
    client = _make_authed_client(monkeypatch)
    from backend.auth import AdminCtx, require_admin

    async def _fake_admin():
        return AdminCtx(user_id=_USER_ID, email="t@t.com", ip="127.0.0.1", user_agent="t")

    client.app.dependency_overrides[require_admin] = _fake_admin
    return client


# --------------------------------------------------------------------------- campaigns


NOW = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)


async def test_campaign_waits_before_starts_at(monkeypatch):
    from marketer.models import Campaign
    from marketer.repos import campaigns as campaigns_repo
    from marketer.services import campaign_runner

    campaign = Campaign(
        id=uuid4(), user_id=_USER_ID, name="future", status="running",
        starts_at=NOW + timedelta(days=2), budget_usd=Decimal("50"),
    )

    async def must_not_run(*a, **k):
        raise AssertionError("no repo access before the window opens")

    monkeypatch.setattr(campaigns_repo, "spent_usd", must_not_run)
    result = await campaign_runner.run_campaign_tick(campaign, now=NOW)
    assert result["action"] == "waiting"


async def test_budget_headroom_projection_limits_spawns(monkeypatch):
    """3 due lanes, headroom for exactly one estimated piece -> one spawn."""
    from marketer.models import Campaign, CampaignItem, Niche, PostingWindow
    from marketer.repos import campaigns as campaigns_repo
    from marketer.repos import niches as niches_repo
    from marketer.services import campaign_runner

    monkeypatch.setattr(settings, "campaign_est_cost_per_piece_usd", 2.5)
    campaign = Campaign(
        id=uuid4(), user_id=_USER_ID, name="tight", status="running",
        starts_at=NOW - timedelta(days=1), budget_usd=Decimal("10"),
    )
    niche_ids = [uuid4() for _ in range(3)]
    items = [
        CampaignItem(id=uuid4(), campaign_id=campaign.id, user_id=_USER_ID,
                     kind="video", ref_id=nid, cadence_per_week=56)
        for nid in niche_ids
    ]

    async def fake_spent(cid, *, user_id):
        return Decimal("5")  # $5 headroom = 2 est pieces...

    async def fake_pending(cid, *, user_id):
        return 1  # ...minus 1 in-flight -> room for exactly 1 more

    async def fake_items(cid, *, user_id):
        return items

    async def fake_counts(cid, *, user_id):
        return {"video": {}, "article": {}, "image": {}}

    async def fake_niche(nid, *, user_id):
        return Niche(
            id=nid, user_id=_USER_ID, title="t", description="d",
            target_audience="a", visual_style="v", voice="onyx",
            target_duration_sec=30, scene_count=2,
            posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
            platforms=["tiktok"], daily_spend_cap_usd=Decimal("5"),
        )

    monkeypatch.setattr(campaigns_repo, "spent_usd", fake_spent)
    monkeypatch.setattr(campaigns_repo, "pending_work_count", fake_pending)
    monkeypatch.setattr(campaigns_repo, "list_items", fake_items)
    monkeypatch.setattr(campaigns_repo, "work_counts", fake_counts)
    monkeypatch.setattr(niches_repo, "get", fake_niche)

    spawned = []

    async def spawn_video(uid, nid, platform, cid):
        spawned.append(nid)

    result = await campaign_runner.run_campaign_tick(
        campaign, spawn_video=spawn_video, now=NOW,
    )
    assert result["action"] == "ticked"
    assert len(spawned) == 1  # not 3


async def test_campaign_runner_image_lane_dispatch(monkeypatch):
    from marketer.models import Campaign, CampaignItem, Niche, PostingWindow
    from marketer.repos import campaigns as campaigns_repo
    from marketer.repos import niches as niches_repo
    from marketer.services import campaign_runner

    campaign = Campaign(
        id=uuid4(), user_id=_USER_ID, name="img", status="running",
        starts_at=NOW - timedelta(days=1), budget_usd=Decimal("50"),
    )
    nid = uuid4()

    async def fake_spent(cid, *, user_id):
        return Decimal("0")

    async def fake_pending(cid, *, user_id):
        return 0

    async def fake_items(cid, *, user_id):
        return [CampaignItem(id=uuid4(), campaign_id=campaign.id,
                             user_id=_USER_ID, kind="image", ref_id=nid,
                             cadence_per_week=7)]

    async def fake_counts(cid, *, user_id):
        return {"video": {}, "article": {}, "image": {}}

    async def fake_niche(niche_id, *, user_id):
        return Niche(
            id=niche_id, user_id=_USER_ID, title="t", description="d",
            target_audience="a", visual_style="v", voice="onyx",
            target_duration_sec=30, scene_count=2,
            posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
            platforms=["reels"], daily_spend_cap_usd=Decimal("5"),
        )

    monkeypatch.setattr(campaigns_repo, "spent_usd", fake_spent)
    monkeypatch.setattr(campaigns_repo, "pending_work_count", fake_pending)
    monkeypatch.setattr(campaigns_repo, "list_items", fake_items)
    monkeypatch.setattr(campaigns_repo, "work_counts", fake_counts)
    monkeypatch.setattr(niches_repo, "get", fake_niche)

    images = []

    async def spawn_image(uid, niche_id, cid):
        images.append(niche_id)

    result = await campaign_runner.run_campaign_tick(
        campaign, spawn_image=spawn_image, now=NOW,
    )
    assert images == [nid]
    assert result["spawned"] == [f"image:{nid}"]


def test_create_campaign_normalizes_naive_datetimes(monkeypatch):
    from marketer.models import Campaign
    import marketer.repos.campaigns as campaigns_repo

    created = {}

    async def fake_create(**kwargs):
        created.update(kwargs)
        return Campaign(
            id=uuid4(), user_id=kwargs["user_id"], name=kwargs["name"],
            objective=kwargs["objective"], budget_usd=kwargs["budget_usd"],
            starts_at=kwargs["starts_at"] or NOW, ends_at=kwargs["ends_at"],
        )

    monkeypatch.setattr(campaigns_repo, "create", fake_create)
    client = _make_authed_client(monkeypatch)

    # naive ends_at + aware starts_at: no 500, tz-normalized, 422 only
    # when actually inverted
    r = client.post("/api/v1/campaigns", json={
        "name": "mix", "budget_usd": "10",
        "starts_at": "2026-08-01T00:00:00Z",
        "ends_at": "2026-08-05T00:00:00",  # naive
    })
    assert r.status_code == 201
    assert created["ends_at"].tzinfo is not None

    r = client.post("/api/v1/campaigns", json={
        "name": "bad", "budget_usd": "10",
        "starts_at": "2026-08-05T00:00:00Z",
        "ends_at": "2026-08-01T00:00:00",
    })
    assert r.status_code == 422


def test_patch_item_wrong_campaign_is_scoped_in_sql(monkeypatch):
    import marketer.repos.campaigns as campaigns_repo

    seen = {}

    async def fake_set(item_id, *, user_id, enabled, campaign_id=None):
        seen["campaign_id"] = campaign_id
        return None  # SQL-scoped miss

    monkeypatch.setattr(campaigns_repo, "set_item_enabled", fake_set)
    client = _make_authed_client(monkeypatch)
    cid, iid = uuid4(), uuid4()
    r = client.patch(f"/api/v1/campaigns/{cid}/items/{iid}", json={"enabled": False})
    assert r.status_code == 404
    assert seen["campaign_id"] == cid  # scope reached the WHERE clause


# --------------------------------------------------------------------------- templates routes


def _fake_template(published=True, kind="image", reference_key=""):
    from marketer.models import Template

    return Template(
        id=uuid4(), kind=kind, name="Desk", prompt="p",
        reference_key=reference_key, is_published=published, created_by="admin",
    )


def test_template_admin_routes_reject_non_admin(monkeypatch):
    client = _make_authed_client(monkeypatch)  # no admin override
    r = client.post("/api/v1/templates", json={
        "kind": "image", "name": "x", "prompt": "p",
    })
    assert r.status_code in (401, 403)
    r = client.put(f"/api/v1/templates/{uuid4()}", json={"name": "y"})
    assert r.status_code in (401, 403)
    r = client.delete(f"/api/v1/templates/{uuid4()}")
    assert r.status_code in (401, 403)


def test_template_admin_create_works_with_admin(monkeypatch):
    import marketer.repos.templates as templates_repo
    from marketer.repos import admin_audit

    async def fake_create(**kwargs):
        return _fake_template(published=kwargs["is_published"])

    async def fake_audit(**kw):
        return None

    monkeypatch.setattr(templates_repo, "create", fake_create)
    monkeypatch.setattr(admin_audit, "record", fake_audit)  # template mutations are audited
    client = _make_admin_client(monkeypatch)
    r = client.post("/api/v1/templates", json={
        "kind": "image", "name": "Desk", "prompt": "cozy desk",
        "is_published": True,
    })
    assert r.status_code == 201


def test_unpublished_reference_hidden(monkeypatch, tmp_path: Path):
    import marketer.repos.templates as templates_repo

    ref = tmp_path / "ref.png"
    ref.write_bytes(b"PNG")
    template = _fake_template(published=False, reference_key=str(ref))

    async def fake_get(tid):
        return template

    monkeypatch.setattr(templates_repo, "get", fake_get)
    client = _make_authed_client(monkeypatch)
    r = client.get(f"/api/v1/templates/{template.id}/reference")
    assert r.status_code == 404


def test_remix_rejects_video_templates_and_oversized_bodies(monkeypatch):
    import marketer.repos.templates as templates_repo

    template = _fake_template(kind="video")

    async def fake_get(tid):
        return template

    monkeypatch.setattr(templates_repo, "get", fake_get)
    client = _make_authed_client(monkeypatch)

    r = client.post(f"/api/v1/templates/{template.id}/remix", json={"count": 1})
    assert r.status_code == 422  # video templates aren't image remixes

    # oversized Content-Length rejected before body parse
    r = client.post(
        f"/api/v1/templates/{template.id}/remix",
        content=b"{}",
        headers={
            "content-type": "application/json",
            "content-length": str(20 * 1024 * 1024),
        },
    )
    assert r.status_code == 413


# --------------------------------------------------------------------------- image post routes


def test_image_post_routes_scoped_and_approve_conflicts(monkeypatch):
    import marketer.repos.image_posts as image_posts_repo
    import marketer.repos.niches as niches_repo

    async def fake_list(user_id, *, status=None, limit=50):
        assert user_id == _USER_ID  # auth scoping reaches the repo
        return []

    async def fake_niche_get(nid, *, user_id):
        return None  # not the caller's niche

    async def fake_claim(pid, *, user_id):
        return False

    async def fake_get(pid, *, user_id):
        return {"id": pid, "status": "done", "user_id": user_id,
                "niche_id": uuid4(), "kind": "single", "topic": "",
                "payload": {}}

    monkeypatch.setattr(image_posts_repo, "list_for_user", fake_list)
    monkeypatch.setattr(image_posts_repo, "claim_for_scheduling", fake_claim)
    monkeypatch.setattr(image_posts_repo, "get", fake_get)
    monkeypatch.setattr(niches_repo, "get", fake_niche_get)

    client = _make_authed_client(monkeypatch)
    assert client.get("/api/v1/image-posts").status_code == 200
    # enqueue against someone else's niche -> 404, nothing spawned
    r = client.post("/api/v1/image-posts", json={"niche_id": str(uuid4())})
    assert r.status_code == 404
    # approve on a non-awaiting post -> 409 with its real status
    r = client.post(f"/api/v1/image-posts/{uuid4()}/approve")
    assert r.status_code == 409


# --------------------------------------------------------------------------- schedule backstop


async def test_schedule_image_post_failure_marks_failed(monkeypatch):
    from marketer.repos import image_posts as repo
    from marketer.repos import niches as niches_repo
    from marketer.models import Niche, PostingWindow
    from marketer.services import image_posts as svc

    pid = uuid4()
    state = {"failed": None}

    async def fake_get(p, *, user_id):
        return {"id": pid, "user_id": _USER_ID, "niche_id": uuid4(),
                "kind": "single", "topic": "", "status": "scheduling",
                "payload": {"slides": [{"index": 0, "path": "/tmp/s.png"}],
                            "caption": "c", "hashtags": []}}

    async def fake_niche(nid, *, user_id):
        return Niche(
            id=nid, user_id=_USER_ID, title="t", description="d",
            target_audience="a", visual_style="v", voice="onyx",
            target_duration_sec=30, scene_count=2,
            posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
            platforms=["reels"], daily_spend_cap_usd=Decimal("5"),
        )

    async def fake_set_status(p, *, user_id, status):
        return {"status": status}

    async def fake_fail(p, *, user_id, error):
        state["failed"] = error
        return {"status": "failed", "error": error}

    monkeypatch.setattr(repo, "get", fake_get)
    monkeypatch.setattr(repo, "set_status", fake_set_status)
    monkeypatch.setattr(repo, "fail", fake_fail)
    monkeypatch.setattr(niches_repo, "get", fake_niche)

    async def exploding_poster(**kwargs):
        raise RuntimeError("ayrshare 500")

    result = await svc.schedule_image_post(
        user_id=_USER_ID, image_post_id=pid, apply_schedule=exploding_poster,
    )
    # terminal 'failed', never stuck in 'scheduling'
    assert result["status"] == "failed"
    assert "ayrshare 500" in state["failed"]


# --------------------------------------------------------------------------- misc units


def test_fal_snap_duration():
    from marketer.services import fal_video

    hailuo = fal_video.get_model("fal-ai/minimax/hailuo-02/standard/image-to-video")
    assert fal_video.snap_duration(hailuo, 4.0) == 6
    assert fal_video.snap_duration(hailuo, 8.5) == 10
    ray2 = fal_video.get_model("fal-ai/luma-dream-machine/ray-2")
    assert fal_video.snap_duration(ray2, 7.0) in (5, 9)


def test_subtitle_positions_pinned(tmp_path: Path):
    from marketer.models import CaptionStyle
    from marketer.services import subtitle

    words = [{"word": "hi", "start": 0.0, "end": 0.5}]
    for position, alignment, margin in (
        ("bottom", 2, 480), ("center", 5, 0), ("top", 8, 160),
    ):
        out = tmp_path / f"{position}.ass"
        subtitle.words_to_ass(
            words, out, caption_style=CaptionStyle(position=position)
        )
        body = out.read_text()
        assert f",{alignment},60,60,{margin},1" in body, position


def test_caption_font_free_text_rejected():
    from pydantic import ValidationError

    from marketer.models import CaptionStyle

    with pytest.raises(ValidationError):
        CaptionStyle(font="Arial,Black{corrupt}")


def test_spend_history_row_allows_nicheless():
    from datetime import date

    from marketer.models import SpendHistoryRow

    row = SpendHistoryRow(day=date(2026, 7, 19), niche_id=None,
                          cost_usd=Decimal("0.75"))
    assert row.niche_id is None


def test_image_platform_selection():
    from marketer.models import Niche, PostingWindow
    from marketer.services.image_posts import image_platform

    def niche(platforms):
        return Niche(
            id=uuid4(), user_id=_USER_ID, title="t", description="d",
            target_audience="a", visual_style="v", voice="onyx",
            target_duration_sec=30, scene_count=2,
            posting_windows=[PostingWindow(hour=9, minute=0, tz="UTC")],
            platforms=platforms, daily_spend_cap_usd=Decimal("5"),
        )

    assert image_platform(niche(["shorts", "reels"])) == "reels"
    assert image_platform(niche(["shorts"])) is None  # fails before spend
    assert image_platform(niche(["tiktok"])) == "tiktok"


def test_providers_route_lists_models(monkeypatch):
    client = _make_authed_client(monkeypatch)
    r = client.get("/api/v1/providers/video-models")
    assert r.status_code == 200
    models = r.json()
    assert models[0]["provider"] == "grok"
    assert any(m["model_id"].startswith("fal-ai/") for m in models)
    assert all(m["available"] is False for m in models if m["provider"] == "fal")

    r = client.get("/api/v1/providers/script-models")
    assert r.status_code == 200
    assert r.json()[0]["model_id"] == ""


def test_ad_kit_knobs_clamped():
    from marketer.services.ad_workflows import _kit_knobs

    knobs = _kit_knobs({
        "target_roas": 0,          # would invert the policy -> clamped up
        "scale_up_pct": 5000,      # runaway -> clamped to 100
        "max_daily_budget_usd": -5,  # nonsense -> dropped
    })
    assert knobs["target_roas"] == Decimal("0.1")
    assert knobs["scale_up_pct"] == Decimal("100")
    assert "max_daily_budget_usd" not in knobs
