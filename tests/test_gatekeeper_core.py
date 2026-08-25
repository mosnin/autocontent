"""Gatekeeper core: policy, speculation, and the ways speculation is refused.

The interesting tests here are the refusals. Speculation is the feature,
but a speculated action that nobody can ever approve — or that a caller
renders to a user as if it were real — is worse than no speculation at
all, so every path that cannot honour the contract must fail loudly
rather than fall back to applying the action.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from marketer.gatekeeper import (
    Capability,
    CapabilityDenied,
    Decision,
    Gatekeeper,
    GatekeeperContext,
    Verdict,
    always,
)

CTX = GatekeeperContext(user_id="user_1", actor="agent", origin="test")


class FakeIntents:
    def __init__(self) -> None:
        self.recorded: list[dict[str, Any]] = []

    async def record(self, **fields: Any) -> str:
        self.recorded.append(fields)
        return f"intent_{len(self.recorded)}"


class FakeAudit:
    def __init__(self, *, explode: bool = False) -> None:
        self.rows: list[dict[str, Any]] = []
        self.explode = explode

    async def write(self, **fields: Any) -> None:
        if self.explode:
            raise RuntimeError("audit sink down")
        self.rows.append(fields)


def _capability(
    *,
    verdict: Verdict = Verdict.ALLOW,
    reason: str = "",
    simulable: bool = True,
    applied: list[str] | None = None,
) -> Capability[dict, str]:
    async def policy(_p: dict, _c: GatekeeperContext) -> Decision:
        return Decision(verdict, reason, Decimal("25"))

    async def apply(p: dict, _c: GatekeeperContext) -> str:
        if applied is not None:
            applied.append(p["to"])
        return f"applied:{p['to']}"

    async def simulate(p: dict, _c: GatekeeperContext) -> str:
        return f"simulated:{p['to']}"

    return Capability(
        name="budget.raise",
        describe=lambda p: f"Raise daily budget to ${p['to']}",
        policy=policy,
        apply=apply,
        simulate=simulate if simulable else None,
    )


# ------------------------------------------------------------------ allow


async def test_allow_applies_for_real_and_is_not_marked_speculative():
    applied: list[str] = []
    gk = Gatekeeper(intents=FakeIntents(), audit=FakeAudit())

    outcome = await gk.invoke(_capability(applied=applied), {"to": "80"}, CTX)

    assert outcome.value == "applied:80"
    assert outcome.speculative is False
    assert outcome.intent_id is None
    assert applied == ["80"]


# ------------------------------------------------------------------- deny


async def test_deny_raises_and_never_applies():
    applied: list[str] = []
    gk = Gatekeeper(intents=FakeIntents(), audit=FakeAudit())
    cap = _capability(verdict=Verdict.DENY, reason="kill-switch is on", applied=applied)

    with pytest.raises(CapabilityDenied) as excinfo:
        await gk.invoke(cap, {"to": "80"}, CTX)

    assert "kill-switch is on" in str(excinfo.value)
    assert applied == [], "a denied action must not reach apply()"


async def test_deny_is_audited():
    audit = FakeAudit()
    gk = Gatekeeper(intents=FakeIntents(), audit=audit)

    with pytest.raises(CapabilityDenied):
        await gk.invoke(_capability(verdict=Verdict.DENY, reason="cap"), {"to": "9"}, CTX)

    assert [r["verdict"] for r in audit.rows] == ["deny"]
    assert audit.rows[0]["reason"] == "cap"


# -------------------------------------------------------------- speculate


async def test_speculate_returns_a_simulated_result_and_moves_nothing():
    applied: list[str] = []
    intents = FakeIntents()
    gk = Gatekeeper(intents=intents, audit=FakeAudit())
    cap = _capability(verdict=Verdict.SPECULATE, reason="over threshold", applied=applied)

    outcome = await gk.invoke(cap, {"to": "500"}, CTX)

    assert outcome.value == "simulated:500"
    assert outcome.speculative is True
    assert outcome.intent_id == "intent_1"
    assert applied == [], "speculation must not apply the action"


async def test_speculated_intent_carries_what_an_approver_needs():
    intents = FakeIntents()
    gk = Gatekeeper(intents=intents, audit=FakeAudit())

    await gk.invoke(
        _capability(verdict=Verdict.SPECULATE, reason="over threshold"),
        {"to": "500"},
        CTX,
    )

    row = intents.recorded[0]
    assert row["capability"] == "budget.raise"
    # A human approving in bulk reads the summary, not the params blob.
    assert row["summary"] == "Raise daily budget to $500"
    assert row["simulated"] == "simulated:500"
    assert row["decision"].dollar_delta == Decimal("25")
    assert row["ctx"].actor == "agent"


async def test_an_unsimulatable_capability_is_denied_not_applied():
    """No simulator means no honest speculative answer. Inventing one is
    worse than refusing, so this escalates to DENY."""
    applied: list[str] = []
    gk = Gatekeeper(intents=FakeIntents(), audit=FakeAudit())
    cap = _capability(verdict=Verdict.SPECULATE, simulable=False, applied=applied)

    with pytest.raises(CapabilityDenied) as excinfo:
        await gk.invoke(cap, {"to": "500"}, CTX)

    assert "cannot be simulated" in str(excinfo.value)
    assert applied == []


async def test_a_caller_that_cannot_accept_speculation_gets_a_denial():
    """A synchronous request a user is watching must not be handed a
    fiction. It says so, and gets refused rather than a fake success."""
    applied: list[str] = []
    gk = Gatekeeper(intents=FakeIntents(), audit=FakeAudit())
    cap = _capability(verdict=Verdict.SPECULATE, applied=applied)
    strict = GatekeeperContext(user_id="user_1", allow_speculation=False)

    with pytest.raises(CapabilityDenied) as excinfo:
        await gk.invoke(cap, {"to": "500"}, strict)

    assert "cannot accept a speculative result" in str(excinfo.value)
    assert applied == []


async def test_speculation_without_an_intent_store_is_refused():
    """An intent nobody stored is an action nobody can approve, while the
    agent believes it succeeded. That is the one unrecoverable state, so
    it must be impossible to reach."""
    applied: list[str] = []
    gk = Gatekeeper(intents=None, audit=FakeAudit())
    cap = _capability(verdict=Verdict.SPECULATE, applied=applied)

    with pytest.raises(CapabilityDenied) as excinfo:
        await gk.invoke(cap, {"to": "500"}, CTX)

    assert "no intent store" in str(excinfo.value)
    assert applied == []


# ------------------------------------------------------------------ audit


async def test_a_broken_audit_sink_does_not_fail_an_allowed_action():
    """The platform call already happened (or will); losing its audit row
    is a gap, not a correctness bug. Failing here would turn a logging
    outage into a product outage."""
    applied: list[str] = []
    gk = Gatekeeper(intents=FakeIntents(), audit=FakeAudit(explode=True))

    outcome = await gk.invoke(_capability(applied=applied), {"to": "80"}, CTX)

    assert outcome.value == "applied:80"
    assert applied == ["80"]


async def test_every_verdict_is_audited_with_its_summary():
    audit = FakeAudit()
    gk = Gatekeeper(intents=FakeIntents(), audit=audit)

    await gk.invoke(_capability(), {"to": "10"}, CTX)
    await gk.invoke(_capability(verdict=Verdict.SPECULATE), {"to": "500"}, CTX)

    assert [r["verdict"] for r in audit.rows] == ["allow", "speculate"]
    assert audit.rows[1]["intent_id"] == "intent_1"
    assert audit.rows[0]["summary"] == "Raise daily budget to $10"


# ----------------------------------------------------------------- helpers


async def test_always_builds_a_fixed_policy():
    cap = Capability(
        name="noop",
        describe=lambda _p: "noop",
        policy=always(Verdict.DENY, "nope"),
        apply=lambda _p, _c: None,
    )
    with pytest.raises(CapabilityDenied):
        await Gatekeeper().invoke(cap, {}, CTX)


def test_decision_allowed_covers_speculate():
    """SPECULATE is a permission, not a refusal — it just needs a human.
    Code branching on `allowed` must treat it as permitted."""
    assert Decision(Verdict.ALLOW).allowed is True
    assert Decision(Verdict.SPECULATE).allowed is True
    assert Decision(Verdict.DENY).allowed is False
