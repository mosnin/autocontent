"""The broker: the single path an external side effect travels.

    invoke(capability, params, ctx)
        -> policy says ALLOW     -> apply for real
        -> policy says DENY      -> raise CapabilityDenied
        -> policy says SPECULATE -> simulate, record the intent, return
                                    a result flagged speculative

Every branch writes an audit row. That is the property that makes this
worth having: after the fact, "what did the agent try to do, what was it
allowed to do, and what actually moved" is answerable from storage rather
than from logs.

Design notes worth keeping
--------------------------
*   **Policy runs before simulate, always.** Simulating first would let a
    denied action leak information about state the caller may not be
    entitled to see.
*   **The intent store is injected.** The core is pure and testable
    without a database; the DB-backed store arrives with reconciliation.
*   **A failed audit write does not fail an allowed action**, but a failed
    audit write on a *speculated* one does — an unrecorded intent is an
    action nobody can ever approve or reject, which is worse than an
    error.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from ..logging import get_logger
from .capability import (
    Capability,
    CapabilityDenied,
    Decision,
    GatekeeperContext,
    Outcome,
    Verdict,
)

log = get_logger(__name__)


class IntentStore(Protocol):
    """Where speculated actions wait for a human.

    A Protocol rather than a base class so tests can pass a list-backed
    fake and the DB implementation can live in `repos/` where every other
    query does.
    """

    async def record(
        self,
        *,
        capability: str,
        params: Any,
        summary: str,
        simulated: Any,
        decision: Decision,
        ctx: GatekeeperContext,
    ) -> str:
        """Persist one pending intent; return its id."""
        ...


class AuditSink(Protocol):
    async def write(
        self,
        *,
        capability: str,
        verdict: str,
        summary: str,
        reason: str,
        ctx: GatekeeperContext,
        intent_id: str | None,
    ) -> None: ...


class _NullAudit:
    """Used only when no sink is wired. Logs rather than silently
    discarding, so a misconfigured deploy is visible instead of quiet."""

    async def write(self, **fields: Any) -> None:
        log.warning("gatekeeper.audit_unwired", extra={"capability": fields.get("capability")})


class Gatekeeper:
    def __init__(
        self,
        *,
        intents: IntentStore | None = None,
        audit: AuditSink | None = None,
    ) -> None:
        self._intents = intents
        self._audit = audit or _NullAudit()

    async def invoke(
        self,
        capability: Capability[Any, Any],
        params: Any,
        ctx: GatekeeperContext,
    ) -> Outcome[Any]:
        decision = await capability.policy(params, ctx)
        summary = capability.describe(params)

        if decision.verdict is Verdict.DENY:
            await self._audit_safely(capability, decision, summary, ctx, None)
            raise CapabilityDenied(capability.name, decision.reason or "denied by policy")

        if decision.verdict is Verdict.SPECULATE:
            return await self._speculate(capability, params, ctx, decision, summary)

        value = await capability.apply(params, ctx)
        await self._audit_safely(capability, decision, summary, ctx, None)
        return Outcome(value=value, speculative=False, decision=decision)

    async def _speculate(
        self,
        capability: Capability[Any, Any],
        params: Any,
        ctx: GatekeeperContext,
        decision: Decision,
        summary: str,
    ) -> Outcome[Any]:
        # Two ways speculation is refused, and both become a hard denial
        # rather than a quiet fallback to applying it. Escalating to DENY
        # is the safe direction: the caller finds out, and no money moves.
        if not capability.speculable:
            reason = (
                f"{decision.reason or 'needs approval'} — and this action cannot "
                "be simulated, so it cannot be queued"
            )
            denial = Decision(Verdict.DENY, reason, decision.dollar_delta, decision.evidence)
            await self._audit_safely(capability, denial, summary, ctx, None)
            raise CapabilityDenied(capability.name, reason)

        if not ctx.allow_speculation:
            reason = (
                f"{decision.reason or 'needs approval'} — the caller cannot accept "
                "a speculative result"
            )
            denial = Decision(Verdict.DENY, reason, decision.dollar_delta, decision.evidence)
            await self._audit_safely(capability, denial, summary, ctx, None)
            raise CapabilityDenied(capability.name, reason)

        assert capability.simulate is not None  # narrowed by `speculable`
        simulated = await capability.simulate(params, ctx)

        if self._intents is None:
            # No store means the intent would evaporate: the agent would
            # believe the action happened and no human could ever approve
            # it. Refuse loudly instead.
            reason = "no intent store configured; refusing to speculate"
            denial = Decision(Verdict.DENY, reason, decision.dollar_delta, decision.evidence)
            await self._audit_safely(capability, denial, summary, ctx, None)
            raise CapabilityDenied(capability.name, reason)

        intent_id = await self._intents.record(
            capability=capability.name,
            params=params,
            summary=summary,
            simulated=simulated,
            decision=decision,
            ctx=ctx,
        )
        await self._audit_safely(capability, decision, summary, ctx, intent_id)
        return Outcome(
            value=simulated,
            speculative=True,
            decision=decision,
            intent_id=intent_id,
        )

    async def _audit_safely(
        self,
        capability: Capability[Any, Any],
        decision: Decision,
        summary: str,
        ctx: GatekeeperContext,
        intent_id: str | None,
    ) -> None:
        """Audit must never be the reason a permitted action fails.

        The asymmetry is deliberate. For ALLOW and DENY the action's own
        record (the platform's, or the exception) survives, so a lost
        audit row is a gap rather than a correctness bug. A speculated
        action has no other record — losing it strands an intent nobody
        can approve — so `_speculate` treats a store failure as fatal
        before it ever reaches here.
        """
        try:
            await self._audit.write(
                capability=capability.name,
                verdict=decision.verdict.value,
                summary=summary,
                reason=decision.reason,
                ctx=ctx,
                intent_id=intent_id,
            )
        except Exception:  # noqa: BLE001 — never fail an action over its audit row
            log.error(
                "gatekeeper.audit_failed",
                exc_info=True,
                extra={"capability": capability.name, "verdict": decision.verdict.value},
            )


# --------------------------------------------------------------- policies

def always(verdict: Verdict, reason: str = "") -> Callable[[Any, GatekeeperContext], Awaitable[Decision]]:
    """A fixed policy. Useful for capabilities whose risk is constant, and
    for tests."""

    async def _policy(_params: Any, _ctx: GatekeeperContext) -> Decision:
        return Decision(verdict, reason)

    return _policy
