"""Execution rails at the dispatch sites: the kill switch stops publishing,
a spawn that times out becomes a Required Action that only a person can
resolve, agent idempotency keys dedupe money moves, and ad approvals are
bound to the exact change (budget from/to, account caps) a person saw.

Repos are faked in memory; the rails use the in-memory store from conftest."""
from __future__ import annotations

import sys
import types
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus

USER = "user_rails"
H = {"Authorization": "Bearer mkt_x"}


def _client(monkeypatch, *, delegated: bool = False) -> TestClient:
    from marketer.config import settings

    monkeypatch.setattr(settings, "clerk_jwks_url", "")
    monkeypatch.setattr(settings, "database_url", "postgres://stub/stub")
    from backend.auth import AuthCtx, require_user
    from backend.main import create_app
    from backend.rate_limit import limiter

    limiter._storage.reset()

    async def _fake():
        return AuthCtx(user_id=USER, email="p@t.com", delegated=delegated)

    app = create_app()
    app.dependency_overrides[require_user] = _fake
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def modal_spawns(monkeypatch):
    calls: list[tuple] = []
    behaviour = {"raise": None}

    class _Fn:
        def __init__(self, name):
            self.name = name

        def spawn(self, *a):
            calls.append((self.name, *a))
            if behaviour["raise"] is not None:
                raise behaviour["raise"]

    monkeypatch.setitem(
        sys.modules, "modal",
        types.SimpleNamespace(Function=types.SimpleNamespace(from_name=lambda app, name: _Fn(name))),
    )
    return calls, behaviour


def _job(job_id: UUID, status: JobStatus = JobStatus.awaiting_approval) -> Job:
    return Job(id=job_id, user_id=USER, niche_id=uuid4(), platform="tiktok", status=status)


@pytest.fixture
def jobs(monkeypatch):
    from marketer.repos import jobs as jobs_repo

    state: dict[UUID, Job] = {}

    async def _claim(job_id, *, user_id):
        j = state.get(job_id)
        if j is None or j.status != JobStatus.awaiting_approval:
            return None
        state[job_id] = j.model_copy(update={"status": JobStatus.scheduling})
        return state[job_id]

    async def _get(job_id, *, user_id):
        return state.get(job_id)

    async def _reset(job_id, *, user_id):
        j = state.get(job_id)
        if j is None or j.status != JobStatus.failed:
            return None
        state[job_id] = j.model_copy(update={"status": JobStatus.queued})
        return state[job_id]

    monkeypatch.setattr(jobs_repo, "claim_for_scheduling", _claim)
    monkeypatch.setattr(jobs_repo, "get", _get)
    monkeypatch.setattr(jobs_repo, "reset_for_retry", _reset)
    return state


# --------------------------------------------------------------------------- publishing


def test_approve_video_runs_unchanged_and_is_recorded(monkeypatch, rails_store, modal_spawns, jobs):
    calls, _ = modal_spawns
    jid = uuid4()
    jobs[jid] = _job(jid)
    resp = _client(monkeypatch).post(f"/api/v1/jobs/{jid}/approve", headers=H)
    assert resp.status_code == 202
    assert calls == [("finish_scheduling", USER, str(jid))]
    [row] = rails_store.rows.values()
    assert (row.action, row.outcome, row.principal, row.target_id) == ("content.video.approve", "succeeded", "user", str(jid))


def test_publish_kill_switch_stops_approval_before_the_claim(monkeypatch, rails_store, modal_spawns, jobs):
    calls, _ = modal_spawns
    jid = uuid4()
    jobs[jid] = _job(jid)
    rails_store.kill_switches.add("publish")
    resp = _client(monkeypatch).post(f"/api/v1/jobs/{jid}/approve", headers=H)
    assert resp.status_code == 402
    assert resp.json()["detail"].startswith("kill_switch")
    assert calls == []
    assert jobs[jid].status == JobStatus.awaiting_approval
    # Rejecting reduces exposure: never blocked by a kill switch.
    from marketer.repos import jobs as jobs_repo

    async def _reject(job_id, *, user_id):
        return jobs[job_id].model_copy(update={"status": JobStatus.failed})

    monkeypatch.setattr(jobs_repo, "claim_for_rejection", _reject)
    rails_store.kill_switches.add("all")
    assert _client(monkeypatch).post(f"/api/v1/jobs/{jid}/reject", headers=H).status_code == 200


def test_spawn_timeout_is_indeterminate_and_lands_in_the_inbox(monkeypatch, rails_store, modal_spawns, jobs):
    from marketer.repos import workspace as ws

    async def _items(user_id, *, limit=200):
        return []

    monkeypatch.setattr(ws, "inbox_items", _items)
    calls, behaviour = modal_spawns
    jid = uuid4()
    jobs[jid] = _job(jid)
    behaviour["raise"] = TimeoutError("modal did not answer")

    resp = _client(monkeypatch).post(f"/api/v1/jobs/{jid}/approve", headers=H)
    assert resp.status_code == 502
    assert resp.json()["detail"].startswith("outcome_unknown")
    assert len(calls) == 1  # sent once, never retried

    inbox = _client(monkeypatch, delegated=True).get("/api/v1/workspace/inbox", headers=H).json()
    assert inbox["items"] == [] and inbox["counts"]["total"] == 0  # old contract untouched
    assert inbox["counts"]["required_action"] == 1
    [ra] = inbox["required_actions"]
    assert ra["kind"] == "indeterminate_outcome" and ra["action"] == "content.video.approve"
    assert ra["target_id"] == str(jid)

    # The agent can read it but never resolve it.
    path = ra["resolve_path"].removeprefix("/api/v1")
    denied = _client(monkeypatch, delegated=True).post(f"/api/v1{path}", json={"resolution": "confirmed_failed"}, headers=H)
    assert denied.status_code == 403
    ok = _client(monkeypatch).post(f"/api/v1{path}", json={"resolution": "confirmed_succeeded"}, headers=H)
    assert ok.status_code == 200
    again = _client(monkeypatch).post(f"/api/v1{path}", json={"resolution": "confirmed_failed"}, headers=H)
    assert again.status_code == 404
    assert _client(monkeypatch).get("/api/v1/workspace/inbox", headers=H).json()["required_actions"] == []


async def _unknown_send(rails_store, target_type: str, target_id: str):
    from marketer import rails

    d = await rails.enforce_dispatch(
        "content.post.send", user_id=USER, principal="system", args={"id": target_id},
        target_type=target_type, target_id=target_id, idempotency_key="",
    )
    await d.indeterminate("ReadTimeout: no answer from the scheduler")
    return d.execution_id


async def test_retry_is_blocked_while_a_post_outcome_is_unknown(monkeypatch, rails_store, modal_spawns, jobs):
    calls, _ = modal_spawns
    jid = uuid4()
    jobs[jid] = _job(jid, JobStatus.failed)
    execution_id = await _unknown_send(rails_store, "video_post", str(jid))

    resp = _client(monkeypatch).post(f"/api/v1/jobs/{jid}/retry", headers=H)
    assert resp.status_code == 409
    assert "outcome_unknown" in resp.json()["detail"]
    assert calls == [] and jobs[jid].status == JobStatus.failed

    await rails_store.resolve(USER, execution_id, resolution="confirmed_failed", resolved_by="p@t.com")
    assert _client(monkeypatch).post(f"/api/v1/jobs/{jid}/retry", headers=H).status_code == 202


async def test_scheduler_timeout_in_the_image_pipeline_is_indeterminate(monkeypatch, rails_store):
    import httpx

    from marketer.repos import image_posts as image_posts_repo
    from marketer.repos import niches as niches_repo
    from marketer.services import image_posts as svc

    pid, seen = uuid4(), {}

    async def _get(image_post_id, *, user_id):
        return {"id": pid, "niche_id": uuid4(), "topic": "t", "payload": {"slides": [{"path": "/tmp/a.png"}], "caption": "c"}}

    async def _niche(niche_id, *, user_id):
        return types.SimpleNamespace(platforms=["reels"], image_platform=None)

    async def _set_status(image_post_id, *, user_id, status):
        seen["status"] = status

    async def _fail(image_post_id, *, user_id, error):
        seen["failed"] = error
        return {"status": "failed", "error": error}

    async def _poster(**kw):
        raise httpx.ReadTimeout("no answer")

    monkeypatch.setattr(image_posts_repo, "get", _get)
    monkeypatch.setattr(niches_repo, "get", _niche)
    monkeypatch.setattr(image_posts_repo, "set_status", _set_status)
    monkeypatch.setattr(image_posts_repo, "fail", _fail)
    monkeypatch.setattr(svc, "image_platform", lambda niche, p: "reels")
    result = await svc.schedule_image_post(user_id=USER, image_post_id=pid, apply_schedule=_poster)
    assert result["status"] == "failed" and "outcome unknown" in seen["failed"]
    [row] = rails_store.rows.values()
    assert (row.action, row.outcome, row.principal, row.target_type) == ("content.post.send", "indeterminate", "system", "carousel_post")


# --------------------------------------------------------------------------- paid media


class AdsWorld:
    """In-memory ads repos: one account, one campaign, approvals, audit."""

    def __init__(self, monkeypatch, *, budget: str | None = "20", daily_cap: str | None = None, threshold: str = "10"):
        from marketer.config import settings
        from marketer.repos import ad_actions, ad_approvals
        from marketer.repos import ads as ads_repo
        from marketer.repos.ad_approvals import AdApproval
        from marketer.repos.ads import AdAccount, AdCampaign

        now = datetime.now(timezone.utc)
        self.account = AdAccount(
            id=uuid4(), user_id=USER, platform="google_ads", external_account_id="x", name="",
            composio_connection_id="", status="active", currency="USD",
            daily_cap_usd=Decimal(daily_cap) if daily_cap else None, monthly_cap_usd=None,
            killswitch=False, last_error="", created_at=now, updated_at=now,
        )
        self.campaign = AdCampaign(
            id=uuid4(), user_id=USER, ad_account_id=self.account.id, name="Spring", status="draft",
            daily_budget_usd=Decimal(budget) if budget else None, created_at=now, updated_at=now,
        )
        self.approvals: dict[UUID, AdApproval] = {}
        self.audit: list[str] = []
        self.applied: list[Decimal] = []
        monkeypatch.setattr(settings, "ads_approval_threshold_usd", float(threshold))

        async def get_campaign(cid, *, user_id):
            return self.campaign if cid == self.campaign.id else None

        async def get_account(aid, *, user_id):
            return self.account if aid == self.account.id else None

        async def zero(*a, **k):
            return Decimal("0")

        async def update_campaign(cid, *, user_id, **kw):
            self.campaign = self.campaign.model_copy(update=kw)
            return self.campaign

        async def create(*, user_id, action, summary="", dollar_delta_usd=Decimal("0"), ad_account_id=None, campaign_id=None, payload=None, requested_by="agent"):
            a = AdApproval(
                id=uuid4(), user_id=user_id, ad_account_id=ad_account_id, campaign_id=campaign_id,
                action=action, summary=summary, dollar_delta_usd=dollar_delta_usd, payload=payload or {},
                requested_by=requested_by, created_at=now, updated_at=now,
            )
            self.approvals[a.id] = a
            return a

        async def get(aid, *, user_id):
            return self.approvals.get(aid)

        async def decide(aid, *, user_id, status, decided_by):
            a = self.approvals.get(aid)
            if a is None or a.status != "pending":
                return None
            self.approvals[aid] = a.model_copy(update={"status": status, "decided_by": decided_by})
            return self.approvals[aid]

        async def mark_executed(aid, *, user_id):
            self.approvals[aid] = self.approvals[aid].model_copy(update={"status": "executed"})

        async def record(**kw):
            self.audit.append(kw["action"])

        for name, fn in {"get_campaign": get_campaign, "get_account": get_account, "update_campaign": update_campaign,
                         "active_daily_budget_total": zero, "account_spend_on": zero, "account_spend_between": zero}.items():
            monkeypatch.setattr(ads_repo, name, fn)
        for name, fn in {"create": create, "get": get, "decide": decide, "mark_executed": mark_executed}.items():
            monkeypatch.setattr(ad_approvals, name, fn)
        monkeypatch.setattr(ad_actions, "record", record)

    async def apply(self, campaign, budget):
        self.applied.append(budget)
        return {"applied": "stub"}


async def test_budget_approval_executes_when_nothing_changed(monkeypatch, rails_store):
    from marketer.services import ad_actions_exec as exec_

    world = AdsWorld(monkeypatch)
    parked = await exec_.propose_budget_change(user_id=USER, campaign_id=world.campaign.id, new_daily_budget_usd=Decimal("35"), actor="agent")
    assert parked["status"] == "pending_approval"
    approval = world.approvals[UUID(parked["approval_id"])]
    assert set(approval.payload["rails"]) == {"action", "args_hash", "governance_hash"}
    assert approval.payload["new_daily_budget_usd"] == "35"

    world.approvals[approval.id] = approval.model_copy(update={"status": "approved"})
    done = await exec_.execute_approved_budget_change(user_id=USER, approval_id=approval.id, apply_fn=world.apply)
    assert done["status"] == "executed" and world.applied == [Decimal("35")]
    assert world.approvals[approval.id].status == "executed"
    outcomes = sorted((r.action, r.outcome) for r in rails_store.rows.values())
    assert outcomes == [("ads.approval.execute", "succeeded"), ("ads.budget.change", "succeeded")]


@pytest.mark.parametrize("drift", ["budget_moved", "cap_edited"])
async def test_budget_approval_is_refused_when_the_world_changed(monkeypatch, rails_store, drift):
    from marketer.services import ad_actions_exec as exec_

    world = AdsWorld(monkeypatch, daily_cap="500")
    parked = await exec_.propose_budget_change(user_id=USER, campaign_id=world.campaign.id, new_daily_budget_usd=Decimal("35"), actor="agent")
    aid = UUID(parked["approval_id"])
    world.approvals[aid] = world.approvals[aid].model_copy(update={"status": "approved"})
    if drift == "budget_moved":
        world.campaign = world.campaign.model_copy(update={"daily_budget_usd": Decimal("30")})
    else:
        world.account = world.account.model_copy(update={"daily_cap_usd": Decimal("1000")})

    with pytest.raises(exec_.AdSpendDenied) as e:
        await exec_.execute_approved_budget_change(user_id=USER, approval_id=aid, apply_fn=world.apply)
    assert e.value.status_code == 409
    assert ("approval_args_mismatch" if drift == "budget_moved" else "approval_governance_changed") in e.value.reason
    assert world.applied == []
    assert rails_store.expired_approvals == [aid]


async def test_legacy_approvals_without_a_binding_still_execute(monkeypatch, rails_store):
    from marketer.services import ad_actions_exec as exec_

    world = AdsWorld(monkeypatch)
    legacy = await __import__("marketer.repos.ad_approvals", fromlist=["create"]).create(
        user_id=USER, action="budget.change", campaign_id=world.campaign.id,
        ad_account_id=world.account.id, payload={"new_daily_budget_usd": "25"},
    )
    world.approvals[legacy.id] = legacy.model_copy(update={"status": "approved"})
    done = await exec_.execute_approved_budget_change(user_id=USER, approval_id=legacy.id, apply_fn=world.apply)
    assert done["status"] == "executed" and world.applied == [Decimal("25")]


async def test_platform_timeout_on_a_budget_change_is_indeterminate(monkeypatch, rails_store):
    import httpx

    from marketer import rails
    from marketer.services import ad_actions_exec as exec_

    world = AdsWorld(monkeypatch, threshold="1000")

    async def timeout(campaign, budget):
        raise httpx.ReadTimeout("platform did not answer")

    with pytest.raises(rails.OutcomeUnknown):
        await exec_.propose_budget_change(user_id=USER, campaign_id=world.campaign.id, new_daily_budget_usd=Decimal("22"), actor="agent", apply_fn=timeout)
    assert world.campaign.daily_budget_usd == Decimal("20")  # never recorded as a fake success
    # The next budget change on this campaign waits for a person.
    with pytest.raises(exec_.AdSpendDenied) as e:
        await exec_.propose_budget_change(user_id=USER, campaign_id=world.campaign.id, new_daily_budget_usd=Decimal("23"), actor="agent", apply_fn=world.apply)
    assert e.value.status_code == 409 and "outcome_unknown" in e.value.reason
    assert "budget.denied" in world.audit


def test_activation_approval_is_bound_to_the_draft_budget(monkeypatch, rails_store):
    world = AdsWorld(monkeypatch, budget="50")
    client = _client(monkeypatch)
    parked = client.post(f"/api/v1/ads/campaigns/{world.campaign.id}/status", json={"status": "active"}, headers=H)
    assert parked.status_code == 200 and parked.json()["status"] == "pending_approval"
    aid = parked.json()["approval_id"]
    assert "rails" in world.approvals[UUID(aid)].payload

    # Someone edits the draft budget after the request: the approval no longer matches.
    world.campaign = world.campaign.model_copy(update={"daily_budget_usd": Decimal("500")})
    resp = client.post(f"/api/v1/ads/approvals/{aid}/decide", json={"decision": "approved"}, headers=H)
    assert resp.status_code == 409
    assert "approval_args_mismatch" in resp.json()["detail"]
    assert world.campaign.status == "draft"
    assert "approval.invalidated" in world.audit


def test_activation_approval_executes_when_unchanged(monkeypatch, rails_store):
    world = AdsWorld(monkeypatch, budget="50")
    client = _client(monkeypatch)
    aid = client.post(f"/api/v1/ads/campaigns/{world.campaign.id}/status", json={"status": "active"}, headers=H).json()["approval_id"]
    resp = client.post(f"/api/v1/ads/approvals/{aid}/decide", json={"decision": "approved"}, headers=H)
    assert resp.status_code == 200 and resp.json()["status"] == "executed"
    assert world.campaign.status == "active"


def test_agent_idempotency_key_dedupes_budget_changes(monkeypatch, rails_store):
    world = AdsWorld(monkeypatch, threshold="1000")
    client = _client(monkeypatch, delegated=True)
    headers = {**H, "idempotency-key": "run1:call7:set_ad_budget"}
    first = client.post(f"/api/v1/ads/campaigns/{world.campaign.id}/budget", json={"daily_budget_usd": "25"}, headers=headers)
    assert first.status_code == 200 and first.json()["status"] == "executed"
    replay = client.post(f"/api/v1/ads/campaigns/{world.campaign.id}/budget", json={"daily_budget_usd": "25"}, headers=headers)
    assert replay.status_code == 409 and "duplicate_dispatch" in replay.json()["detail"]
    [row] = [r for r in rails_store.rows.values() if r.outcome == "succeeded"]
    assert (row.principal, row.tier, row.idempotency_key) == ("agent", "CRITICAL", "run1:call7:set_ad_budget")
    # Without a key (the web app), behaviour is unchanged: each request runs.
    plain = _client(monkeypatch)
    assert plain.post(f"/api/v1/ads/campaigns/{world.campaign.id}/budget", json={"daily_budget_usd": "26"}, headers=H).status_code == 200


def test_spend_kill_switch_blocks_campaign_start(monkeypatch, rails_store):
    from marketer.models import Campaign
    from marketer.repos import campaigns as campaigns_repo

    cid = uuid4()
    camp = Campaign(id=cid, user_id=USER, name="Launch", budget_usd=Decimal("100"))

    async def _get(campaign_id, *, user_id):
        return camp

    async def _set_status(campaign_id, *, user_id, status):
        return camp.model_copy(update={"status": status})

    monkeypatch.setattr(campaigns_repo, "get", _get)
    monkeypatch.setattr(campaigns_repo, "set_status", _set_status)
    rails_store.kill_switches.add("spend")
    assert _client(monkeypatch).post(f"/api/v1/campaigns/{cid}/start", headers=H).status_code == 402
    rails_store.kill_switches.clear()
    resp = _client(monkeypatch).post(f"/api/v1/campaigns/{cid}/start", headers=H)
    assert resp.status_code == 200 and resp.json()["status"] == "running"
