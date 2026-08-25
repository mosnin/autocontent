"""Turning approved intents into real effects, and noticing when the
simulation was wrong.

This is the other half of speculative execution. The broker hands an agent
a simulated result so it can keep working; this module is what eventually
makes that result true — or reports honestly that it did not come true.

Divergence is the whole risk of the design
------------------------------------------
When the Gatekeeper says "budget raised to $80" and the agent plans three
more steps on that basis, two things can make it false by the time a human
approves:

*   somebody else changed the underlying state in between, or
*   the platform rejected or altered the action (a creative fails review,
    a budget is clamped to an account maximum).

Either way the agent acted on a premise that no longer holds. Silently
succeeding there is the failure mode that would make speculation
indefensible, so a divergent apply is recorded as divergence, surfaced in
the inbox, and audited under its own verdict. The action still happened —
we do not pretend otherwise — but nobody gets to believe the original
story.

`compare` is deliberately conservative: it reports a difference whenever
it cannot prove equivalence. A false divergence report costs a human ten
seconds; a missed one costs them their premise.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from ..logging import get_logger
from ..repos import gatekeeper as repo
from .capability import Capability, GatekeeperContext

log = get_logger(__name__)

# How an applied result is compared against what was simulated. Returning
# a string means "these differ, and here is what a human needs to read".
Comparator = Callable[[Any, Any], str | None]


def compare(simulated: Any, observed: Any) -> str | None:
    """Default comparator: equal, or explain the difference.

    Dicts are compared key-by-key on the SIMULATED keys only. A platform
    that returns extra fields we never claimed anything about has not
    contradicted us — over-reporting those as divergence would train
    operators to ignore the signal, which is the one thing this must not
    become.
    """
    if simulated == observed:
        return None

    if isinstance(simulated, dict) and isinstance(observed, dict):
        drifted = [
            f"{key}: simulated {simulated[key]!r}, actual {observed.get(key)!r}"
            for key in simulated
            if key not in observed or observed[key] != simulated[key]
        ]
        if not drifted:
            return None
        return "; ".join(drifted)

    return f"simulated {simulated!r}, actual {observed!r}"


async def apply_intent(
    intent: dict,
    capability: Capability[Any, Any],
    *,
    comparator: Comparator = compare,
    audit: Callable[..., Awaitable[None]] | None = None,
) -> dict:
    """Apply one approved intent for real.

    Claims the row BEFORE the external call. A crash between claim and
    completion leaves a row the reaper can find; the alternative ordering
    risks two workers both calling the platform, and double-spending real
    money is worse than a stranded row a human investigates.
    """
    intent_id = intent["id"]
    claimed = await repo.claim_for_apply(
        intent_id if isinstance(intent_id, UUID) else UUID(str(intent_id))
    )
    if claimed is None:
        # Not approved, or another worker already claimed it. Both mean
        # "not ours" — never retry, or the effect happens twice.
        log.info("gatekeeper.apply_skipped", extra={"intent_id": str(intent_id)})
        return intent

    ctx = GatekeeperContext(
        user_id=claimed["user_id"],
        actor="system",
        origin=f"reconcile:{claimed['capability']}",
    )

    try:
        observed = await capability.apply(claimed["params"], ctx)
    except Exception as exc:  # noqa: BLE001 — a provider failure is data, not a crash
        failed = await repo.fail_apply(claimed["id"], error=f"{type(exc).__name__}: {exc}")
        if audit is not None:
            await audit(
                user_id=claimed["user_id"],
                capability=claimed["capability"],
                verdict="apply",
                summary=claimed["summary"],
                reason=f"failed: {exc}",
                intent_id=claimed["id"],
            )
        return failed

    diverged = comparator(claimed.get("simulated"), observed)
    applied = await repo.complete_apply(
        claimed["id"], observed=observed, diverged=diverged
    )

    if audit is not None:
        await audit(
            user_id=claimed["user_id"],
            capability=claimed["capability"],
            verdict="diverge" if diverged else "apply",
            summary=claimed["summary"],
            reason=diverged or "",
            intent_id=claimed["id"],
        )
    if diverged:
        # Loud on purpose. An agent planned further work on the simulated
        # result; somebody has to know that premise broke.
        log.warning(
            "gatekeeper.diverged",
            extra={
                "intent_id": str(claimed["id"]),
                "capability": claimed["capability"],
                "detail": diverged,
            },
        )
    return applied


async def run_apply_queue(
    resolve: Callable[[str], Capability[Any, Any] | None],
    *,
    limit: int = 50,
    audit: Callable[..., Awaitable[None]] | None = None,
) -> dict:
    """Apply every approved intent, oldest decision first.

    Order matters: an operator's approvals take effect in the order they
    made them, because later actions may assume earlier ones landed.

    An unknown capability fails its intent rather than being skipped. A
    silently-skipped intent sits in `approved` forever, looking to the
    operator like it is about to happen.
    """
    queued = await repo.pending_apply_queue(limit=limit)
    applied = diverged = failed = 0

    for intent in queued:
        capability = resolve(intent["capability"])
        if capability is None:
            await repo.fail_apply(
                intent["id"],
                error=f"unknown capability {intent['capability']!r}; nothing applied",
            )
            failed += 1
            continue

        result = await apply_intent(intent, capability, audit=audit)
        if result.get("status") == repo.FAILED:
            failed += 1
        elif result.get("diverged"):
            diverged += 1
        else:
            applied += 1

    return {
        "queued": len(queued),
        "applied": applied,
        "diverged": diverged,
        "failed": failed,
    }
