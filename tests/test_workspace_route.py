"""Route tests for /api/v1/workspace. The workspace repo and the department
repos are monkeypatched; auth is bypassed via dependency_overrides except in
the delegation tests, which drive the real require_user with the agent
service token."""
from __future__ import annotations

import sys
import types
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus, User
from tests.auth_helpers import ctx_for

H = {"Authorization": "Bearer mkt_x"}
USER = "user_ws"


def _reset_limiter():
    from backend.rate_limit import limiter

    limiter._storage.reset()


def _app(monkeypatch, *, override_auth: bool = True):
    from marketer.config import settings

    monkeypatch.setattr(settings, "auth_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import require_user
    from backend.main import create_app

    app = create_app()
    if override_auth:
        async def _fake():
            return ctx_for("owner", user_id=USER, email="ws@t.com")

        app.dependency_overrides[require_user] = _fake
    _reset_limiter()
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def fake_modal(monkeypatch):
    spawned: list[tuple] = []

    class _Fn:
        def __init__(self, name):
            self.name = name

        def spawn(self, *a):
            spawned.append((self.name, *a))

    monkeypatch.setitem(
        sys.modules,
        "modal",
        types.SimpleNamespace(
            Function=types.SimpleNamespace(from_name=lambda app, name: _Fn(name))
        ),
    )
    return spawned


def _kpis(**kw):
    base = dict(
        content_spend_usd=Decimal("0"), ad_spend_usd=Decimal("0"), ad_clicks=0,
        ad_conversions=Decimal("0"), posts_published=0, articles_published=0,
        views=0, engagements=0,
    )
    base.update(kw)
    return base


def _patch_overview(monkeypatch, *, current, previous, by_day, pipeline, top, seen):
    from marketer.repos import workspace as ws

    async def _kp(user_id, *, start, end):
        seen.setdefault("kpi_windows", []).append((user_id, start, end))
        return current if len(seen["kpi_windows"]) == 1 else previous

    async def _series(user_id, *, start, end):
        seen["series"] = (start, end)
        return by_day

    async def _pipe(user_id, *, start, end):
        return pipeline

    async def _top(user_id, *, start, end, limit):
        seen["top_limit"] = limit
        return top

    monkeypatch.setattr(ws, "window_kpis", _kp)
    monkeypatch.setattr(ws, "daily_series", _series)
    monkeypatch.setattr(ws, "pipeline_counts", _pipe)
    monkeypatch.setattr(ws, "top_content", _top)


_PIPE = {
    "content": {"active": 2, "done": 14, "failed": 1},
    "seo": {"active": 0, "done": 3, "failed": 0},
    "ads": {"active_campaigns": 1, "pending_approvals": 2},
}


# --------------------------------------------------------------------------- overview


def test_overview_contract(monkeypatch):
    today = datetime.now(timezone.utc).date()
    seen: dict = {}
    created = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
    _patch_overview(
        monkeypatch,
        current=_kpis(
            content_spend_usd=Decimal("10.0000"), ad_spend_usd=Decimal("2.4"),
            posts_published=14, articles_published=3, views=18000,
            engagements=900, ad_clicks=7, ad_conversions=Decimal("2.50"),
        ),
        previous=_kpis(content_spend_usd=Decimal("1.23456")),
        by_day={today: {"content_spend_usd": Decimal("0.4"), "ad_spend_usd": Decimal("0"),
                        "views": 1200, "posts": 1}},
        pipeline=_PIPE,
        top=[
            {"kind": "video", "id": "j1", "title": "Hook", "platform": "tiktok",
             "views": 1200, "created_at": created},
            {"kind": "article", "id": "a1", "title": "Guide", "platform": None,
             "views": None, "created_at": created},
        ],
        seen=seen,
    )
    client = _app(monkeypatch)
    resp = client.get("/api/v1/workspace/overview?days=7", headers=H)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"days", "kpis", "previous_kpis", "series", "pipeline", "top_content"}
    assert body["days"] == 7
    assert body["kpis"] == {
        "total_spend_usd": "12.40", "content_spend_usd": "10.00", "ad_spend_usd": "2.40",
        "posts_published": 14, "articles_published": 3, "views": 18000,
        "engagements": 900, "ad_clicks": 7, "ad_conversions": 3,
    }
    assert body["previous_kpis"]["content_spend_usd"] == "1.23"
    assert body["previous_kpis"]["total_spend_usd"] == "1.23"
    assert set(body["previous_kpis"]) == set(body["kpis"])

    # One zero-filled row per day, oldest first, ending today.
    series = body["series"]
    assert len(series) == 7
    assert series[0]["day"] == (today - timedelta(days=6)).isoformat()
    assert series[-1] == {"day": today.isoformat(), "content_spend_usd": "0.40",
                          "ad_spend_usd": "0.00", "views": 1200, "posts": 1}
    assert series[0] == {"day": series[0]["day"], "content_spend_usd": "0.00",
                         "ad_spend_usd": "0.00", "views": 0, "posts": 0}

    assert body["pipeline"] == _PIPE
    assert body["top_content"][0]["kind"] == "video"
    assert body["top_content"][0]["views"] == 1200
    assert body["top_content"][1]["platform"] is None
    assert body["top_content"][1]["views"] is None
    assert seen["top_limit"] == 8

    # Windows: current = [today-6, tomorrow), previous = the 7 days before.
    (_, s1, e1), (_, s2, e2) = seen["kpi_windows"]
    assert s1.date() == today - timedelta(days=6)
    assert e1.date() == today + timedelta(days=1)
    assert e2 == s1 and (s1 - s2) == timedelta(days=7)
    assert s1.tzinfo is not None


@pytest.mark.parametrize("days", [0, 366, -1])
def test_overview_days_bounds(monkeypatch, days):
    client = _app(monkeypatch)
    assert client.get(f"/api/v1/workspace/overview?days={days}", headers=H).status_code == 422


def test_overview_default_days_30(monkeypatch):
    seen: dict = {}
    _patch_overview(monkeypatch, current=_kpis(), previous=_kpis(), by_day={},
                    pipeline=_PIPE, top=[], seen=seen)
    client = _app(monkeypatch)
    body = client.get("/api/v1/workspace/overview", headers=H).json()
    assert body["days"] == 30
    assert len(body["series"]) == 30
    assert body["kpis"]["total_spend_usd"] == "0.00"


def test_overview_requires_auth(monkeypatch):
    client = _app(monkeypatch, override_auth=False)
    assert client.get("/api/v1/workspace/overview").status_code == 401


# --------------------------------------------------------------------------- inbox


def _inbox_rows():
    niche = uuid4()
    t0 = datetime(2026, 11, 15, 9, tzinfo=timezone.utc)
    return niche, [
        {"source": "video", "id": uuid4(), "platform": "tiktok", "niche_id": niche,
         "niche_title": "Coffee", "title": "3 brewing myths", "created_at": t0},
        {"source": "carousel", "id": uuid4(), "kind": "carousel", "platform": None,
         "niche_id": niche, "niche_title": "Coffee", "title": "5 diagrams",
         "created_at": t0 + timedelta(hours=1)},
        {"source": "ad_change", "id": uuid4(), "action": "budget.change",
         "summary": "Set daily budget to $35", "dollar_delta_usd": Decimal("15"),
         "payload": {"new_daily_budget_usd": "35"}, "created_at": t0 + timedelta(hours=2),
         "campaign_name": "Spring sale", "campaign_daily_budget_usd": Decimal("20.00"),
         "niche_id": None},
    ]


def test_inbox_contract(monkeypatch):
    from marketer.repos import workspace as ws

    niche, rows = _inbox_rows()

    async def _items(user_id, *, limit=200):
        assert user_id == USER
        return list(rows)

    monkeypatch.setattr(ws, "inbox_items", _items)
    client = _app(monkeypatch)
    resp = client.get("/api/v1/workspace/inbox", headers=H)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The original keys are unchanged; the rails added `required_action` and
    # `required_actions` alongside them (additive, backward compatible).
    assert body["counts"] == {"total": 3, "video": 1, "carousel": 1, "ad_change": 1, "required_action": 0}
    assert body["required_actions"] == []
    items = body["items"]
    assert [i["kind"] for i in items] == ["ad_change", "carousel", "video"]  # newest first
    ad, car, vid = items
    assert set(ad) == {"id", "kind", "ref_id", "title", "detail", "niche_id", "created_at"}
    assert ad["id"] == f"ad_change:{rows[2]['id']}"
    assert ad["ref_id"] == str(rows[2]["id"])
    assert ad["detail"] == "Raise daily budget $20 → $35 on Spring sale"
    assert ad["niche_id"] is None
    assert vid["id"] == f"video:{rows[0]['id']}"
    assert vid["title"] == "3 brewing myths"
    assert vid["detail"] == "tiktok · Coffee"
    assert vid["niche_id"] == str(niche)
    assert car["detail"] == "Coffee"


def test_inbox_ad_change_detail_variants():
    from backend.routes.workspace import _ad_change_detail

    base = {"action": "budget.change", "summary": "", "campaign_name": "Fall",
            "campaign_daily_budget_usd": Decimal("50"),
            "payload": {"new_daily_budget_usd": "25.50"}}
    assert _ad_change_detail(base) == "Lower daily budget $50 → $25.50 on Fall"
    assert _ad_change_detail({**base, "campaign_daily_budget_usd": None}) == (
        "Set daily budget to $25.50 on Fall"
    )
    act = {"action": "campaign.activate", "summary": "x", "campaign_name": "Fall",
           "campaign_daily_budget_usd": Decimal("40"), "payload": {}}
    assert _ad_change_detail(act) == "Activate Fall at $40/day"
    other = {"action": "creative.swap", "summary": "Swap creative", "payload": {}}
    assert _ad_change_detail(other) == "Swap creative"


def test_inbox_empty(monkeypatch):
    from marketer.repos import workspace as ws

    async def _items(user_id, *, limit=200):
        return []

    monkeypatch.setattr(ws, "inbox_items", _items)
    client = _app(monkeypatch)
    body = client.get("/api/v1/workspace/inbox", headers=H).json()
    assert body == {
        "items": [],
        "counts": {"total": 0, "video": 0, "carousel": 0, "ad_change": 0, "required_action": 0},
        "required_actions": [],
    }


# --------------------------------------------------------------------------- decide


def _job(status=JobStatus.awaiting_approval) -> Job:
    return Job(id=uuid4(), user_id=USER, niche_id=uuid4(), platform="tiktok", status=status)


def test_decide_video_approve_dispatches_to_job_claim(monkeypatch, fake_modal):
    from marketer.repos import jobs as jobs_repo

    job = _job()
    calls: list = []

    async def _claim(job_id, *, user_id):
        calls.append((job_id, user_id))
        return job.model_copy(update={"status": JobStatus.scheduling})

    monkeypatch.setattr(jobs_repo, "claim_for_scheduling", _claim)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/video/{job.id}/decide",
                       json={"decision": "approve"}, headers=H)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "kind": "video", "ref_id": str(job.id),
                           "decision": "approve"}
    assert calls == [(job.id, USER)]
    assert fake_modal == [("finish_scheduling", USER, str(job.id))]


def test_decide_video_reject(monkeypatch):
    from marketer.repos import jobs as jobs_repo

    job = _job()

    async def _claim(job_id, *, user_id):
        return job.model_copy(update={"status": JobStatus.failed})

    monkeypatch.setattr(jobs_repo, "claim_for_rejection", _claim)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/video/{job.id}/decide",
                       json={"decision": "reject"}, headers=H)
    assert resp.status_code == 200
    assert resp.json()["decision"] == "reject"


def test_decide_video_not_found_404(monkeypatch):
    from marketer.repos import jobs as jobs_repo

    async def _none(*a, **k):
        return None

    monkeypatch.setattr(jobs_repo, "claim_for_rejection", _none)
    monkeypatch.setattr(jobs_repo, "get", _none)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/video/{uuid4()}/decide",
                       json={"decision": "reject"}, headers=H)
    assert resp.status_code == 404


def test_decide_video_already_decided_409(monkeypatch):
    from marketer.repos import jobs as jobs_repo

    job = _job(JobStatus.done)

    async def _none(*a, **k):
        return None

    async def _get(job_id, *, user_id):
        return job

    monkeypatch.setattr(jobs_repo, "claim_for_rejection", _none)
    monkeypatch.setattr(jobs_repo, "get", _get)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/video/{job.id}/decide",
                       json={"decision": "reject"}, headers=H)
    assert resp.status_code == 409


def test_decide_carousel_approve(monkeypatch, fake_modal):
    from marketer.repos import image_posts as ip_repo

    pid = uuid4()

    async def _claim(image_post_id, *, user_id):
        return image_post_id == pid and user_id == USER

    monkeypatch.setattr(ip_repo, "claim_for_scheduling", _claim)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/carousel/{pid}/decide",
                       json={"decision": "approve"}, headers=H)
    assert resp.status_code == 200, resp.text
    assert fake_modal == [("finish_image_post", USER, str(pid))]


def test_decide_carousel_reject(monkeypatch):
    from marketer.repos import image_posts as ip_repo

    pid = uuid4()

    async def _claim(image_post_id, *, user_id):
        return {"id": image_post_id, "status": "failed"}

    monkeypatch.setattr(ip_repo, "claim_for_rejection", _claim)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/carousel/{pid}/decide",
                       json={"decision": "reject"}, headers=H)
    assert resp.status_code == 200
    assert resp.json()["kind"] == "carousel"


def test_decide_carousel_reject_not_found_and_conflict(monkeypatch):
    from marketer.repos import image_posts as ip_repo

    state: dict = {"existing": None}

    async def _claim(image_post_id, *, user_id):
        return None

    async def _get(image_post_id, *, user_id):
        return state["existing"]

    monkeypatch.setattr(ip_repo, "claim_for_rejection", _claim)
    monkeypatch.setattr(ip_repo, "get", _get)
    client = _app(monkeypatch)
    url = f"/api/v1/workspace/inbox/carousel/{uuid4()}/decide"
    assert client.post(url, json={"decision": "reject"}, headers=H).status_code == 404
    state["existing"] = {"status": "scheduling"}
    assert client.post(url, json={"decision": "reject"}, headers=H).status_code == 409


def test_image_post_reject_route(monkeypatch):
    """The new department-level reject endpoint mirrors job reject."""
    from marketer.repos import image_posts as ip_repo

    pid = uuid4()

    async def _claim(image_post_id, *, user_id):
        return {"id": str(image_post_id), "status": "failed",
                "error": ip_repo.REJECTION_ERROR}

    monkeypatch.setattr(ip_repo, "claim_for_rejection", _claim)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/image-posts/{pid}/reject", headers=H)
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"


def _approval(**kw):
    from marketer.repos.ad_approvals import AdApproval

    now = datetime.now(timezone.utc)
    base = dict(id=uuid4(), user_id=USER, action="budget.change",
                summary="Set daily budget to $35", dollar_delta_usd=Decimal("15"),
                payload={"new_daily_budget_usd": "35"}, status="pending",
                created_at=now, updated_at=now)
    base.update(kw)
    return AdApproval(**base)


def test_decide_ad_change_approve_executes_and_audits(monkeypatch):
    import backend.routes.ads as ads_routes
    from marketer.repos import ad_actions, ad_approvals

    appr = _approval()
    seen: dict = {"audit": [], "executed": []}

    async def _get(approval_id, *, user_id):
        return appr if (approval_id == appr.id and user_id == USER) else None

    async def _decide(approval_id, *, user_id, status, decided_by):
        seen["decide"] = (approval_id, user_id, status, decided_by)
        return appr.model_copy(update={"status": status})

    async def _record(**kw):
        seen["audit"].append(kw)

    async def _exec(**kw):
        seen["executed"].append(kw)
        return {}

    monkeypatch.setattr(ad_approvals, "get", _get)
    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", _record)
    monkeypatch.setattr(ads_routes, "execute_approved_budget_change", _exec)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/ad_change/{appr.id}/decide",
                       json={"decision": "approve"}, headers=H)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "kind": "ad_change", "ref_id": str(appr.id),
                           "decision": "approve"}
    assert seen["decide"][2] == "approved"
    assert seen["audit"][0]["action"] == "approval.approved"
    assert seen["executed"][0]["approval_id"] == appr.id


def test_decide_ad_change_reject_does_not_execute(monkeypatch):
    import backend.routes.ads as ads_routes
    from marketer.repos import ad_actions, ad_approvals

    appr = _approval()
    executed: list = []

    async def _get(approval_id, *, user_id):
        return appr

    async def _decide(approval_id, *, user_id, status, decided_by):
        return appr.model_copy(update={"status": status})

    async def _record(**kw):
        return None

    async def _exec(**kw):
        executed.append(kw)

    monkeypatch.setattr(ad_approvals, "get", _get)
    monkeypatch.setattr(ad_approvals, "decide", _decide)
    monkeypatch.setattr(ad_actions, "record", _record)
    monkeypatch.setattr(ads_routes, "execute_approved_budget_change", _exec)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/ad_change/{appr.id}/decide",
                       json={"decision": "reject"}, headers=H)
    assert resp.status_code == 200
    assert executed == []


def test_decide_ad_change_not_owned_404(monkeypatch):
    from marketer.repos import ad_approvals

    async def _get(approval_id, *, user_id):
        return None

    monkeypatch.setattr(ad_approvals, "get", _get)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/ad_change/{uuid4()}/decide",
                       json={"decision": "approve"}, headers=H)
    assert resp.status_code == 404


def test_decide_ad_change_already_decided_409(monkeypatch):
    from marketer.repos import ad_approvals

    appr = _approval(status="approved")

    async def _get(approval_id, *, user_id):
        return appr

    async def _decide(*a, **k):
        return None

    monkeypatch.setattr(ad_approvals, "get", _get)
    monkeypatch.setattr(ad_approvals, "decide", _decide)
    client = _app(monkeypatch)
    resp = client.post(f"/api/v1/workspace/inbox/ad_change/{appr.id}/decide",
                       json={"decision": "approve"}, headers=H)
    assert resp.status_code == 409


def test_decide_rejects_bad_input(monkeypatch):
    client = _app(monkeypatch)
    rid = uuid4()
    assert client.post(f"/api/v1/workspace/inbox/article/{rid}/decide",
                       json={"decision": "approve"}, headers=H).status_code == 404
    assert client.post("/api/v1/workspace/inbox/video/not-a-uuid/decide",
                       json={"decision": "approve"}, headers=H).status_code == 404
    assert client.post(f"/api/v1/workspace/inbox/video/{rid}/decide",
                       json={"decision": "maybe"}, headers=H).status_code == 422


# --------------------------------------------------------------------------- activity


def _activity_rows(t0: datetime):
    jid, aid, cid = uuid4(), uuid4(), uuid4()
    return jid, [
        {"source": "video", "id": jid, "status": "done", "platform": "tiktok",
         "error": None, "niche_title": "Coffee", "title": "Myths", "at": t0},
        {"source": "article", "id": aid, "status": "failed", "error": "boom",
         "niche_title": "Coffee", "title": "Guide", "at": t0 - timedelta(minutes=1)},
        {"source": "carousel", "id": uuid4(), "status": "awaiting_approval",
         "error": None, "platform": None, "niche_title": "Coffee", "title": "Slides",
         "at": t0 - timedelta(minutes=2)},
        {"source": "ad_action", "id": 42, "actor": "user", "action": "budget.change",
         "platform": "google_ads", "target_type": "ad_campaign", "target_id": str(cid),
         "dollar_delta_usd": Decimal("15"), "at": t0 - timedelta(minutes=3)},
        {"source": "approval", "id": uuid4(), "action": "budget.change",
         "summary": "Set daily budget to $35", "status": "executed",
         "decided_by": "ws@t.com", "dollar_delta_usd": Decimal("15"),
         "at": t0 - timedelta(minutes=4)},
        {"source": "campaign", "id": cid, "name": "Launch", "objective": "signups",
         "status": "running", "budget_usd": Decimal("250"), "at": t0 - timedelta(minutes=5)},
    ]


def test_activity_contract_and_pagination(monkeypatch):
    from marketer.repos import workspace as ws

    t0 = datetime(2026, 11, 16, 10, tzinfo=timezone.utc)
    jid, rows = _activity_rows(t0)
    seen: dict = {}

    async def _events(user_id, *, before, limit):
        seen["args"] = (user_id, before, limit)
        return rows[:limit]

    monkeypatch.setattr(ws, "activity_events", _events)
    client = _app(monkeypatch)

    resp = client.get("/api/v1/workspace/activity?limit=50", headers=H)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["next_before"] is None  # fewer than limit → last page
    ev = body["events"]
    assert [e["kind"] for e in ev] == ["video", "article", "carousel", "ad_action",
                                       "approval", "campaign"]
    assert set(ev[0]) == {"id", "at", "kind", "status", "title", "detail", "ref_id"}
    assert ev[0]["id"] == f"job:{jid}:done"
    assert ev[0]["detail"] == "tiktok · Coffee"
    assert ev[1]["status"] == "failed" and "boom" in ev[1]["detail"]
    assert ev[2]["id"].startswith("carousel:") and ev[2]["status"] == "awaiting_approval"
    assert ev[3]["id"] == "ad_action:42" and ev[3]["status"] == "budget.change"
    assert ev[3]["title"] == "Budget change"
    assert "+$15/day" in ev[3]["detail"]
    assert ev[4]["status"] == "executed" and ev[4]["title"] == "Set daily budget to $35"
    assert ev[5]["title"] == "Launch" and ev[5]["status"] == "running"
    assert seen["args"] == (USER, None, 50)

    resp = client.get("/api/v1/workspace/activity?limit=2&before=2026-11-16T11:00:00Z",
                      headers=H)
    body = resp.json()
    assert len(body["events"]) == 2
    assert body["next_before"] is not None
    assert datetime.fromisoformat(body["next_before"].replace("Z", "+00:00")) == (
        t0 - timedelta(minutes=1)
    )
    assert seen["args"][1] == datetime(2026, 11, 16, 11, tzinfo=timezone.utc)
    assert seen["args"][2] == 2


def test_activity_naive_before_treated_as_utc(monkeypatch):
    from marketer.repos import workspace as ws

    seen: dict = {}

    async def _events(user_id, *, before, limit):
        seen["before"] = before
        return []

    monkeypatch.setattr(ws, "activity_events", _events)
    client = _app(monkeypatch)
    resp = client.get("/api/v1/workspace/activity?before=2026-11-16T11:00:00", headers=H)
    assert resp.status_code == 200
    assert resp.json() == {"events": [], "next_before": None}
    assert seen["before"].tzinfo is not None


def test_activity_limit_bounds(monkeypatch):
    client = _app(monkeypatch)
    assert client.get("/api/v1/workspace/activity?limit=0", headers=H).status_code == 422
    assert client.get("/api/v1/workspace/activity?limit=201", headers=H).status_code == 422


# --------------------------------------------------------------------------- delegated auth


SERVICE_TOKEN = "svc_" + "b" * 40


def _delegation(monkeypatch, users: dict[str, User]):
    from marketer.config import settings
    from marketer.repos import users as users_repo

    monkeypatch.setattr(settings, "agent_service_token", SERVICE_TOKEN)

    async def _get(uid):
        return users.get(uid)

    monkeypatch.setattr(users_repo, "get", _get)


def test_delegated_inbox_scoped_to_tenant(monkeypatch):
    from marketer.repos import workspace as ws

    _delegation(monkeypatch, {"tenant_1": User(id="tenant_1", email="t1@x.io")})
    seen: dict = {}

    async def _items(user_id, *, limit=200):
        seen["user_id"] = user_id
        return []

    monkeypatch.setattr(ws, "inbox_items", _items)
    client = _app(monkeypatch, override_auth=False)
    resp = client.get(
        "/api/v1/workspace/inbox",
        headers={"Authorization": f"Bearer {SERVICE_TOKEN}", "x-tenant-id": "tenant_1"},
    )
    assert resp.status_code == 200, resp.text
    assert seen["user_id"] == "tenant_1"


def test_delegated_missing_tenant_401(monkeypatch):
    _delegation(monkeypatch, {})
    client = _app(monkeypatch, override_auth=False)
    resp = client.get("/api/v1/workspace/inbox",
                      headers={"Authorization": f"Bearer {SERVICE_TOKEN}"})
    assert resp.status_code == 401


def test_delegated_never_reaches_admin(monkeypatch):
    _delegation(monkeypatch, {"boss": User(id="boss", email="b@x.io", role="admin")})
    client = _app(monkeypatch, override_auth=False)
    resp = client.get(
        "/api/v1/admin/users",
        headers={"Authorization": f"Bearer {SERVICE_TOKEN}", "x-tenant-id": "boss"},
    )
    assert resp.status_code == 403


def test_series_days_are_dates():
    # Guard the zero-fill helper's key type: repo returns date keys.
    from backend.routes.workspace import _midnight

    assert _midnight(date(2026, 11, 1)).isoformat() == "2026-11-01T00:00:00+00:00"
