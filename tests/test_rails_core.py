"""Execution rails core (marketer.rails): the truth table row by row, canonical
argument hashes (shared vectors with the agent harness), outcome
classification, and the enforcement point against the in-memory store."""
from __future__ import annotations

import asyncio
import re
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest

from marketer import rails
from marketer.rails import actions
from marketer.rails.canonical import args_hash, canonical_json, governance_hash, sha256_hex
from marketer.rails.outcomes import classify
from marketer.rails.policy import ApprovalBinding, CapsVerdict, DispatchFacts, evaluate
from marketer.services.ad_spend_guard import AccountGovernance

USER = "user_rails"

# --------------------------------------------------------------------------- canonical

# The same vectors live in agent/test/marketer-rails.test.ts: both sides must
# serialise JSON-native arguments to the same bytes.
VECTORS = [
    ({"b": 1, "a": "x"}, '{"a":"x","b":1}', "cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246"),
    (
        {"tool": "set_ad_budget", "args": {"campaignId": "3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b", "dailyBudgetUsd": 35, "reason": "Scale the winner"}},
        '{"args":{"campaignId":"3f2b8c1e-7a4d-4e5f-9b6a-0c1d2e3f4a5b","dailyBudgetUsd":35,"reason":"Scale the winner"},"tool":"set_ad_budget"}',
        "5d326874c4f85b147c2a653fb0e034146b2264320fc64a439a560c687b9686e9",
    ),
    (
        {"z": [3, {"y": None, "x": True}], "name": "café ✓", "n": -2},
        '{"n":-2,"name":"café ✓","z":[3,{"x":true,"y":null}]}',
        "b46e777014dafe5d0a3ef7f8d2e10663206ea21ed42ba8a60fcd540ad36dc63c",
    ),
]


@pytest.mark.parametrize("value,text,digest", VECTORS)
def test_canonical_vectors_match_the_agent(value, text, digest):
    assert canonical_json(value) == text
    assert sha256_hex(text) == digest


def test_args_hash_ignores_key_order_and_money_formatting():
    cid = uuid4()
    a = args_hash("ads.budget.change", {"campaign_id": cid, "new_daily_budget_usd": Decimal("35.00")})
    b = args_hash("ads.budget.change", {"new_daily_budget_usd": Decimal("35"), "campaign_id": str(cid)})
    assert a == b
    assert a != args_hash("ads.budget.change", {"campaign_id": cid, "new_daily_budget_usd": Decimal("35.01")})
    assert a != args_hash("ads.campaign.activate", {"campaign_id": cid, "new_daily_budget_usd": Decimal("35")})
    assert canonical_json({"x": 2.0, "y": Decimal("0.00")}) == '{"x":2,"y":"0"}'


def test_canonical_refuses_non_finite_and_unknown_types():
    with pytest.raises(ValueError):
        canonical_json({"x": float("nan")})
    with pytest.raises(TypeError):
        canonical_json({"x": object()})


def test_governance_hash_changes_with_any_cap_or_switch():
    base = AccountGovernance(status="active", killswitch=False, daily_cap_usd=Decimal("100"), monthly_cap_usd=None)
    h = governance_hash(base)
    assert governance_hash(replace(base, daily_cap_usd=Decimal("100.00"))) == h
    for changed in (
        replace(base, daily_cap_usd=Decimal("150")),
        replace(base, monthly_cap_usd=Decimal("500")),
        replace(base, killswitch=True),
        replace(base, status="error"),
    ):
        assert governance_hash(changed) != h
    assert governance_hash(None) != h


# --------------------------------------------------------------------------- truth table

SPEND = actions.ACTIONS["ads.budget.change"]
PUBLISH = actions.ACTIONS["content.video.approve"]
PAUSE = actions.ACTIONS["ads.campaign.pause"]
GOVERN = actions.ACTIONS["ads.account.governance"]


def _facts(**kw):
    base = dict(action=SPEND, kill_switches=frozenset(), kill_switch_known=True)
    base.update(kw)
    return DispatchFacts(**base)


def _binding(**kw):
    base = dict(status="approved", stored_args_hash="a", current_args_hash="a", stored_governance_hash="g", current_governance_hash="g")
    base.update(kw)
    return ApprovalBinding(**base)


@pytest.mark.parametrize(
    "facts,allowed,code,status",
    [
        (_facts(action=None), False, "unregistered_action", 403),
        (_facts(kill_switch_known=False), False, "rails_unavailable", 503),
        (_facts(kill_switches=frozenset({"all"})), False, "kill_switch", 402),
        (_facts(kill_switches=frozenset({"spend"})), False, "kill_switch", 402),
        (_facts(kill_switches=frozenset({"publish"})), True, "ok", 200),
        (_facts(action=PUBLISH, kill_switches=frozenset({"publish"})), False, "kill_switch", 402),
        (_facts(action=PUBLISH, kill_switches=frozenset({"spend"})), True, "ok", 200),
        (_facts(action=PAUSE, kill_switches=frozenset({"all", "spend"})), True, "ok", 200),
        (_facts(action=GOVERN, kill_switches=frozenset({"spend", "publish"})), True, "ok", 200),
        (_facts(action=GOVERN, kill_switches=frozenset({"all"})), False, "kill_switch", 402),
        (_facts(caps=CapsVerdict(False, "over cap")), False, "cap_exceeded", 402),
        (_facts(caps=CapsVerdict(True)), True, "ok", 200),
        (_facts(unresolved_on_target=True), False, "outcome_unknown", 409),
        (_facts(action=PAUSE, unresolved_on_target=True), True, "ok", 200),
        (_facts(approval=_binding(status="pending")), False, "approval_not_approved", 409),
        (_facts(approval=_binding(status="executed")), False, "approval_not_approved", 409),
        (_facts(approval=_binding(stored_args_hash=None)), True, "legacy_unbound", 200),
        (_facts(approval=_binding(current_args_hash="b")), False, "approval_args_mismatch", 409),
        (_facts(approval=_binding(current_governance_hash="h")), False, "approval_governance_changed", 409),
        (_facts(approval=_binding(stored_governance_hash=None, current_governance_hash="h")), True, "ok", 200),
        (_facts(approval=_binding()), True, "ok", 200),
        (_facts(), True, "ok", 200),
    ],
)
def test_truth_table(facts, allowed, code, status):
    verdict = evaluate(facts)
    assert (verdict.allowed, verdict.code) == (allowed, code)
    if not allowed:
        assert verdict.http_status == status and verdict.reason


def test_first_failing_check_wins():
    # A kill switch beats a cap breach and a bad approval; an unknown store beats everything.
    v = evaluate(_facts(kill_switches=frozenset({"all"}), caps=CapsVerdict(False, "x"), approval=_binding(current_args_hash="b")))
    assert v.code == "kill_switch"
    v = evaluate(_facts(kill_switch_known=False, kill_switches=frozenset({"all"})))
    assert v.code == "rails_unavailable"


def test_every_registered_action_is_high_or_critical_and_money_is_critical():
    for spec in actions.ACTIONS.values():
        assert spec.tier in ("HIGH", "CRITICAL")
        assert spec.scopes <= {"publish", "spend"}
    assert {n for n, a in actions.ACTIONS.items() if a.tier == "CRITICAL"} == {
        "ads.budget.change", "ads.campaign.activate", "ads.approval.execute",
    }


def test_agent_registry_points_at_registered_backend_actions():
    """agent/src/marketer/rails/registry.ts names the backend action each
    HIGH/CRITICAL tool dispatches; every one must exist here with the same tier."""
    ts = (Path(__file__).resolve().parents[1] / "agent/src/marketer/rails/registry.ts").read_text()
    pairs = re.findall(r'tier:\s*"(HIGH|CRITICAL)",\s*backendAction:\s*"([a-z_.]+)"', ts)
    assert len(pairs) >= 10
    for tier, name in pairs:
        if name == "none":
            continue
        assert name in actions.ACTIONS, name
        if tier == "CRITICAL":
            # A CRITICAL tool may only reach CRITICAL backend actions.
            assert actions.ACTIONS[name].tier == "CRITICAL", name


# --------------------------------------------------------------------------- outcomes


def _status_error(code: int) -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "https://api.example.test/post")
    return httpx.HTTPStatusError("x", request=req, response=httpx.Response(code, request=req))


class _Definite(Exception):
    pass


@pytest.mark.parametrize(
    "exc,outcome",
    [
        (httpx.ConnectError("refused"), "failed"),
        (httpx.ConnectTimeout("slow"), "failed"),
        (httpx.PoolTimeout("pool"), "failed"),
        (httpx.ReadTimeout("read"), "indeterminate"),
        (httpx.WriteTimeout("write"), "indeterminate"),
        (httpx.RemoteProtocolError("dropped"), "indeterminate"),
        (_status_error(422), "failed"),
        (_status_error(503), "indeterminate"),
        (asyncio.TimeoutError(), "indeterminate"),
        (ConnectionResetError(), "indeterminate"),
        (RuntimeError("who knows"), "indeterminate"),
        (_Definite("guard said no"), "failed"),
    ],
)
def test_classify(exc, outcome):
    assert classify(exc, definite=(_Definite,)) == outcome


# --------------------------------------------------------------------------- enforcement point


async def _dispatch(action: str = "content.post.send", **kw):
    base = dict(user_id=USER, principal="agent", args={"job_id": "j1"}, target_type="video_post", target_id="j1")
    base.update(kw)
    return await rails.enforce_dispatch(action, **base)


async def test_success_is_recorded(rails_store):
    d = await _dispatch()
    assert await d.run(lambda: asyncio.sleep(0, result="post_1")) == "post_1"
    row = rails_store.rows[d.execution_id]
    assert (row.outcome, row.principal, row.tier, row.action) == ("succeeded", "agent", "HIGH", "content.post.send")
    assert row.args_hash == args_hash("content.post.send", {"job_id": "j1"})


async def test_kill_switch_denies_and_records(rails_store):
    rails_store.kill_switches.add("publish")
    with pytest.raises(rails.RailsDenied) as e:
        await _dispatch()
    assert (e.value.code, e.value.status_code) == ("kill_switch", 402)
    assert [r.outcome for r in rails_store.rows.values()] == ["denied"]


async def test_unreadable_store_fails_closed(rails_store):
    rails_store.fail_reads = True
    with pytest.raises(rails.RailsDenied) as e:
        await _dispatch()
    assert (e.value.code, e.value.status_code) == ("rails_unavailable", 503)


async def test_unregistered_action_is_refused(rails_store):
    with pytest.raises(rails.RailsDenied) as e:
        await rails.enforce_dispatch("content.post.teleport", user_id=USER, principal="user", args={})
    assert e.value.code == "unregistered_action"


async def test_caps_exceptions_propagate_unchanged(rails_store):
    class GuardDenied(Exception):
        pass

    async def caps():
        raise GuardDenied("over cap")

    with pytest.raises(GuardDenied):
        await _dispatch(action="ads.budget.change", caps=caps)


async def test_timeout_after_send_is_indeterminate_and_blocks_the_target(rails_store):
    d = await _dispatch()

    async def send():
        raise httpx.ReadTimeout("no answer")

    with pytest.raises(rails.OutcomeUnknown):
        await d.run(send)
    assert rails_store.rows[d.execution_id].outcome == "indeterminate"
    open_actions = await rails_store.open_required_actions(USER)
    assert [r.id for r in open_actions] == [d.execution_id]

    # Never retried: the next dispatch on the same target is refused until a person resolves it.
    with pytest.raises(rails.RailsDenied) as e:
        await _dispatch()
    assert (e.value.code, e.value.status_code) == ("outcome_unknown", 409)
    with pytest.raises(rails.RailsDenied):
        await rails.assert_no_unresolved(USER, "video_post", "j1")

    resolved = await rails_store.resolve(USER, d.execution_id, resolution="confirmed_failed", resolved_by="me@x")
    assert resolved is not None
    await rails.assert_no_unresolved(USER, "video_post", "j1")
    await _dispatch()


async def test_definite_failure_reraises_original_and_frees_the_key(rails_store):
    d = await _dispatch(idempotency_key="key-1")

    async def send():
        raise _Definite("rejected")

    with pytest.raises(_Definite):
        await d.run(send, definite=(_Definite,))
    assert rails_store.rows[d.execution_id].outcome == "failed"
    # Same key may run again after a definite failure.
    again = await _dispatch(idempotency_key="key-1")
    await again.succeeded()


async def test_idempotency_key_dedupes_replays(rails_store):
    d = await _dispatch(idempotency_key="key-2")
    await d.succeeded()
    with pytest.raises(rails.RailsDenied) as e:
        await _dispatch(idempotency_key="key-2")
    assert (e.value.code, e.value.status_code) == ("duplicate_dispatch", 409)
    # A different key is a different call.
    await (await _dispatch(idempotency_key="key-3", target_id="j2")).succeeded()


async def test_request_idempotency_key_comes_from_the_context(rails_store):
    rails.set_request_idempotency_key("ctx-key")
    try:
        d = await _dispatch()
        assert rails_store.rows[d.execution_id].idempotency_key == "ctx-key"
        # An explicit empty key opts out (approval executions key on the approval).
        d2 = await _dispatch(idempotency_key="", target_id="j9")
        assert rails_store.rows[d2.execution_id].idempotency_key is None
    finally:
        rails.set_request_idempotency_key(None)


async def test_args_mismatch_expires_the_approval(rails_store):
    approval_id = uuid4()
    with pytest.raises(rails.RailsDenied) as e:
        await rails.enforce_dispatch(
            "ads.approval.execute", user_id=USER, principal="user", args={"approval_id": approval_id},
            approval=ApprovalBinding(status="approved", stored_args_hash="a", current_args_hash="b"),
            approval_id=approval_id,
        )
    assert e.value.code == "approval_args_mismatch"
    assert rails_store.expired_approvals == [approval_id]


async def test_stale_dispatching_rows_count_as_unknown(rails_store):
    from datetime import timedelta

    d = await _dispatch()
    rails_store.rows[d.execution_id].created_at -= timedelta(minutes=30)
    assert await rails_store.has_unresolved(USER, "video_post", "j1")
    assert isinstance(d.execution_id, UUID)
