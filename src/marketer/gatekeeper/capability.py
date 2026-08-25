"""Capabilities: the unit a Gatekeeper moderates.

A capability is one externally-visible side effect — raise a campaign's
budget, publish a post, create an ad creative. Declaring one means
supplying three things, and the middle one is the whole point:

    policy     may this happen, given who is asking and what it costs?
    simulate   what WOULD happen, computed locally, touching nothing
    apply      actually do it

Most systems have the first and the third. The second is what lets an
agent keep working while a human is asleep.

Why speculation matters
-----------------------
This codebase already has a fail-closed choke point for ad spend
(`services/ad_actions_exec.py`): anything above the approval threshold is
parked and the caller stops. That is correct and it is also the reason
operators eventually turn guardrails off — an agent that stalls on step
one of twelve is useless, so people reach for the "skip permissions"
switch and lose the guardrail entirely.

A Gatekeeper takes the third option. It computes what the action *would*
do, records the intent, hands the caller a result marked
``speculative=True``, and lets the agent continue planning against it. The
human approves in bulk later. Nothing external moved in the meantime.

The cost of that trade is honest and worth naming: a speculated result can
later turn out to be wrong (someone else changed the budget; the platform
rejected the creative). Detecting that divergence is a first-class part of
the design, not an afterthought — see `Outcome.diverged` and the
reconciliation phase.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Any, Generic, TypeVar

Params = TypeVar("Params")
Result = TypeVar("Result")


class Verdict(str, Enum):
    """What policy decided about one attempted action."""

    #: Do it now. Cheap, reversible, or explicitly pre-authorised.
    ALLOW = "allow"
    #: Do not do it, ever, on these terms. A cap, a kill-switch, a
    #: suspended account. Never becomes ALLOW by waiting.
    DENY = "deny"
    #: Permitted in principle but needs a human. Simulate and queue.
    SPECULATE = "speculate"


@dataclass(frozen=True)
class Decision:
    """Policy's answer, plus the reason a human will read later.

    ``reason`` is not optional in spirit: a denial or a queued approval
    that cannot explain itself is an outage from the operator's side of
    the screen.
    """

    verdict: Verdict
    reason: str = ""
    #: Money this action commits, when that is meaningful. Drives both the
    #: approval threshold and what the approval inbox shows.
    dollar_delta: Decimal = Decimal("0")
    #: Anything the policy wants preserved for the audit row.
    evidence: dict[str, Any] = field(default_factory=dict)

    @property
    def allowed(self) -> bool:
        return self.verdict is not Verdict.DENY


@dataclass(frozen=True)
class Outcome(Generic[Result]):
    """What the caller gets back — real or simulated, always labelled.

    ``speculative`` is deliberately not hideable. Any caller that renders
    this to a user, or stores it, has to decide what to do about the fact
    that it might not have happened yet.
    """

    value: Result
    speculative: bool
    decision: Decision
    #: Set when the action was queued: the id to approve later.
    intent_id: str | None = None
    #: Set on reconciliation when reality disagreed with the simulation.
    diverged: str | None = None


class CapabilityDenied(RuntimeError):
    """Policy refused outright. Distinct from a provider error, because a
    caller should never retry this — waiting changes nothing."""

    def __init__(self, capability: str, reason: str) -> None:
        super().__init__(f"{capability}: {reason}")
        self.capability = capability
        self.reason = reason


PolicyFn = Callable[[Any, "GatekeeperContext"], Awaitable[Decision]]
SimulateFn = Callable[[Any, "GatekeeperContext"], Awaitable[Any]]
ApplyFn = Callable[[Any, "GatekeeperContext"], Awaitable[Any]]


@dataclass(frozen=True)
class GatekeeperContext:
    """Who is acting, and on whose behalf.

    ``actor`` distinguishes an agent-initiated action from a human one,
    because the two get different policies: a human raising their own
    budget is not the same event as an optimisation loop doing it at 3am.
    """

    user_id: str
    #: "human" | "agent" | "system"
    actor: str = "human"
    #: Free-form origin for the audit trail: a job id, a playbook name.
    origin: str = ""
    #: When False, SPECULATE is escalated to DENY. Callers that cannot
    #: cope with an unreal result (a synchronous HTTP request a user is
    #: watching) set this rather than silently rendering a fiction.
    allow_speculation: bool = True


@dataclass(frozen=True)
class Capability(Generic[Params, Result]):
    """One moderated side effect.

    Kept a plain frozen dataclass of functions rather than a class
    hierarchy: a capability is data about how to do a thing, and making it
    data is what lets the registry be inspected, tested, and rendered in
    an approval inbox without importing every provider client.
    """

    name: str
    #: Human sentence for the approval inbox: "Raise daily budget to $80".
    describe: Callable[[Params], str]
    policy: PolicyFn
    apply: ApplyFn
    #: Omitted when an action cannot be meaningfully simulated. Such a
    #: capability can only ALLOW or DENY — it never speculates, because a
    #: made-up result is worse than a blocked agent.
    simulate: SimulateFn | None = None
    #: False for anything that cannot be undone once applied (a published
    #: post, a sent email). Surfaced in the inbox so a bulk approve is an
    #: informed one.
    reversible: bool = True

    @property
    def speculable(self) -> bool:
        return self.simulate is not None
