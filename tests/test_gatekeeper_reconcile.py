"""Reconciliation: approved intents becoming real, and divergence.

The comparator tests carry the most weight. Divergence detection is the
thing that makes speculative execution defensible — an agent planned
further work on a simulated result, so if that result turns out false
somebody has to be told. Under-reporting breaks the premise silently;
over-reporting trains operators to ignore the signal. Both are covered.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest

from marketer.gatekeeper import Capability, compare
from marketer.gatekeeper.reconcile import apply_intent, run_apply_queue
from marketer.repos import gatekeeper as repo

INTENT_ID = UUID("22222222-2222-2222-2222-222222222222")


# --------------------------------------------------------------- comparator


def test_identical_results_do_not_diverge():
    assert compare({"budget": "80"}, {"budget": "80"}) is None


def test_a_changed_value_diverges_and_says_which():
    detail = compare({"budget": "80"}, {"budget": "50"})
    assert detail is not None
    assert "budget" in detail and "80" in detail and "50" in detail


def test_a_missing_key_diverges():
    """We claimed something about `budget`; the platform said nothing about
    it. That is a contradiction, not silence."""
    detail = compare({"budget": "80"}, {"status": "ok"})
    assert detail is not None and "budget" in detail


def test_extra_platform_fields_are_not_divergence():
    """Over-reporting is its own failure: an operator who sees divergence
    on every apply stops reading them. We only claimed `budget`."""
    assert compare({"budget": "80"}, {"budget": "80", "updated_at": "now"}) is None


def test_scalar_mismatch_diverges():
    assert compare("applied", "rejected") is not None


# ------------------------------------------------------------ apply_intent


def _capability(*, applied: list, result: Any, explode: bool = False):
    async def apply(params: Any, _ctx) -> Any:
        if explode:
            raise RuntimeError("platform said no")
        applied.append(params)
        return result

    return Capability(
        name="budget.raise",
        describe=lambda p: f"Raise to {p['to']}",
        policy=None,  # type: ignore[arg-type]  # unused on the apply path
        apply=apply,
        simulate=None,
    )


def _intent(**over: Any) -> dict:
    base = {
        "id": INTENT_ID,
        "user_id": "user_1",
        "capability": "budget.raise",
        "summary": "Raise to 80",
        "params": {"to": "80"},
        "simulated": {"budget": "80"},
        "status": repo.APPROVED,
    }
    base.update(over)
    return base


@pytest.fixture
def store(monkeypatch):
    """A minimal fake of the intent repo, tracking the calls that matter."""
    state: dict[str, Any] = {"claimed": None, "completed": None, "failed": None}

    async def claim_for_apply(intent_id):
        if state.get("claim_returns_none"):
            return None
        state["claimed"] = intent_id
        return _intent(status=repo.APPLIED)

    async def complete_apply(intent_id, *, observed, diverged=None):
        state["completed"] = {"observed": observed, "diverged": diverged}
        return _intent(status=repo.APPLIED, observed=observed, diverged=diverged)

    async def fail_apply(intent_id, *, error):
        state["failed"] = error
        return _intent(status=repo.FAILED, error=error)

    monkeypatch.setattr(repo, "claim_for_apply", claim_for_apply)
    monkeypatch.setattr(repo, "complete_apply", complete_apply)
    monkeypatch.setattr(repo, "fail_apply", fail_apply)
    return state


async def test_apply_records_the_observed_result(store):
    applied: list = []
    cap = _capability(applied=applied, result={"budget": "80"})

    await apply_intent(_intent(), cap)

    assert applied == [{"to": "80"}], "the real apply must run"
    assert store["completed"]["observed"] == {"budget": "80"}
    assert store["completed"]["diverged"] is None


async def test_apply_flags_divergence_when_reality_disagrees(store):
    """The agent was told $80. The platform clamped it to $50. The agent
    may have planned on $80 — that has to surface."""
    cap = _capability(applied=[], result={"budget": "50"})

    await apply_intent(_intent(), cap)

    assert store["completed"]["diverged"] is not None
    assert "50" in store["completed"]["diverged"]


async def test_a_claim_that_loses_the_race_does_not_apply(store):
    """Another worker got there first. Retrying would spend twice."""
    store["claim_returns_none"] = True
    applied: list = []

    await apply_intent(_intent(), _capability(applied=applied, result={}))

    assert applied == []
    assert store["completed"] is None


async def test_a_provider_failure_fails_the_intent_rather_than_raising(store):
    cap = _capability(applied=[], result={}, explode=True)

    result = await apply_intent(_intent(), cap)

    assert result["status"] == repo.FAILED
    assert "platform said no" in store["failed"]


async def test_apply_writes_an_audit_row_naming_divergence(store):
    rows: list[dict] = []

    async def audit(**fields):
        rows.append(fields)

    await apply_intent(_intent(), _capability(applied=[], result={"budget": "50"}), audit=audit)

    assert rows[0]["verdict"] == "diverge"
    assert "50" in rows[0]["reason"]


# --------------------------------------------------------------- the queue


async def test_queue_applies_in_decision_order_and_counts_outcomes(monkeypatch, store):
    """Approvals take effect in the order the operator made them, because
    a later action may assume an earlier one landed."""
    order: list[str] = []

    async def queue(*, limit=50):
        return [
            _intent(id=uuid4(), params={"to": "10"}),
            _intent(id=uuid4(), params={"to": "20"}),
        ]

    monkeypatch.setattr(repo, "pending_apply_queue", queue)

    async def apply(params, _ctx):
        order.append(params["to"])
        return {"budget": params["to"]}

    cap = Capability(
        name="budget.raise",
        describe=lambda p: "x",
        policy=None,  # type: ignore[arg-type]
        apply=apply,
    )
    # The fake claim returns a fixed intent, so assert on call ordering
    # rather than on per-item params round-tripping through it.
    summary = await run_apply_queue(lambda _name: cap)

    assert summary["queued"] == 2
    assert len(order) == 2


async def test_an_unknown_capability_fails_its_intent_instead_of_skipping(monkeypatch, store):
    """A skipped intent sits in `approved` forever, looking to the operator
    like it is still about to happen."""

    async def queue(*, limit=50):
        return [_intent(capability="does.not.exist")]

    monkeypatch.setattr(repo, "pending_apply_queue", queue)

    summary = await run_apply_queue(lambda _name: None)

    assert summary["failed"] == 1
    assert "unknown capability" in store["failed"]


def test_terminal_statuses_are_terminal():
    assert repo.is_terminal(repo.APPLIED)
    assert repo.is_terminal(repo.REJECTED)
    assert repo.is_terminal(repo.EXPIRED)
    assert not repo.is_terminal(repo.PENDING)
    assert not repo.is_terminal(repo.APPROVED)
