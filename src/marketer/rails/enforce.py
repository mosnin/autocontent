"""The backend enforcement point (docs/rails/enforcement-point.md).

``enforce_dispatch`` is the one function every HIGH/CRITICAL backend path
calls right before its side effect. It reads **current** facts (kill
switches, caps, unresolved unknown outcomes on the target, the stored
approval binding), runs the pure truth table in ``policy.py``, claims the
caller's idempotency key, and opens an execution record. The caller then
performs the side effect through the returned ``Dispatch`` so the outcome is
recorded: ``succeeded``, ``failed`` or ``indeterminate``.

Why one function: a check that lives in five places drifts into five
slightly different checks. A cached "yes" from earlier in the request (or
from when the approval was requested) never authorises; only the facts read
here do.

Failure semantics: if the rails store cannot be read or written, the dispatch
is refused (503). These paths publish or spend; acting without a record of
the attempt would make an unknown outcome invisible.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, TypeVar
from uuid import UUID

from . import actions as actions_mod
from .canonical import args_hash as compute_args_hash
from .outcomes import Outcome, classify
from .policy import ApprovalBinding, CapsVerdict, DispatchFacts, Verdict, evaluate
from .store import NewExecution, get_store

log = logging.getLogger(__name__)
T = TypeVar("T")

# The `idempotency-key` header of the current request (set by
# `rails_request_context`, a router dependency on every route module that
# dispatches). The agent harness derives it from run + call + tool + args.
_IDEMPOTENCY_KEY: ContextVar[str | None] = ContextVar("rails_idempotency_key", default=None)
_MAX_KEY_LEN = 200


class RailsDenied(Exception):
    """The enforcement point refused. Nothing was sent."""

    def __init__(self, code: str, reason: str, status_code: int) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.status_code = status_code

    @classmethod
    def from_verdict(cls, verdict: Verdict) -> RailsDenied:
        return cls(verdict.code, verdict.reason, verdict.http_status)


class OutcomeUnknown(Exception):
    """The side effect was sent and we do not know whether it landed.

    Recorded as ``indeterminate``; surfaced to the person as a Required
    Action; never retried automatically."""

    def __init__(self, action: str, execution_id: UUID | None, cause: BaseException) -> None:
        super().__init__(
            f"outcome unknown for {action} ({type(cause).__name__}: {str(cause)[:300]}). "
            "Check the platform before trying again; it is listed in the inbox."
        )
        self.action = action
        self.execution_id = execution_id
        self.cause = cause


def set_request_idempotency_key(value: str | None) -> None:
    key = (value or "").strip()
    _IDEMPOTENCY_KEY.set(key[:_MAX_KEY_LEN] if key else None)


def current_idempotency_key() -> str | None:
    return _IDEMPOTENCY_KEY.get()


def principal_of(ctx: Any) -> str:
    """'agent' when the agent harness acts for the user (service-token
    delegation), else 'user'. Background jobs pass 'system' themselves."""
    return "agent" if getattr(ctx, "delegated", False) else "user"


@dataclass
class Dispatch:
    """One open dispatch. Settle it exactly once."""

    action: str
    user_id: str
    execution_id: UUID | None
    claim_key: str | None = None
    settled: Outcome | None = field(default=None)

    async def _finish(self, outcome: Outcome, *, detail: dict[str, Any] | None = None, error: str = "") -> None:
        if self.settled is not None:
            return
        self.settled = outcome
        store = get_store()
        try:
            if self.execution_id is not None:
                await store.finish(self.execution_id, outcome, detail=detail, error=error)
            # A definite failure frees the key so the same call may run again;
            # success and unknown keep it, so a replay can never send twice.
            if outcome == "failed" and self.claim_key:
                await store.release(self.claim_key)
        except Exception:  # noqa: BLE001 - the side effect already happened or not; log loudly
            log.error("rails: could not record outcome %s for %s (%s)", outcome, self.action, self.execution_id, exc_info=True)

    async def succeeded(self, detail: dict[str, Any] | None = None) -> None:
        await self._finish("succeeded", detail=detail)

    async def failed(self, error: str, detail: dict[str, Any] | None = None) -> None:
        await self._finish("failed", detail=detail, error=error)

    async def indeterminate(self, error: str, detail: dict[str, Any] | None = None) -> None:
        await self._finish("indeterminate", detail=detail, error=error)

    async def run(
        self,
        send: Callable[[], Awaitable[T]],
        *,
        definite: tuple[type[BaseException], ...] = (),
        detail: Callable[[T], dict[str, Any]] | None = None,
    ) -> T:
        """Perform the side effect and record its outcome.

        A definite failure re-raises the original exception (callers keep
        their existing error mapping). An ambiguous one is recorded
        ``indeterminate`` and raised as ``OutcomeUnknown``."""
        try:
            result = await send()
        except BaseException as exc:  # noqa: BLE001 - classified, recorded, re-raised
            outcome = classify(exc, definite=definite)
            message = f"{type(exc).__name__}: {exc}"[:2000]
            if outcome == "failed":
                await self.failed(message)
                raise
            await self.indeterminate(message)
            raise OutcomeUnknown(self.action, self.execution_id, exc) from exc
        await self.succeeded(detail(result) if detail else None)
        return result


async def assert_no_unresolved(user_id: str, target_type: str, target_id: str) -> None:
    """Refuse (409) while *target* has an unknown outcome nobody resolved.
    Used by MEDIUM retry paths that end in a HIGH send."""
    try:
        unresolved = await get_store().has_unresolved(user_id, target_type, target_id)
    except Exception as exc:  # noqa: BLE001
        raise RailsDenied("rails_unavailable", "rails store unavailable; refusing to act", 503) from exc
    if unresolved:
        raise RailsDenied(
            "outcome_unknown",
            "an earlier attempt has an unknown outcome; check the platform and resolve it in the inbox first",
            409,
        )


async def enforce_dispatch(
    action: str,
    *,
    user_id: str,
    principal: str,
    args: Mapping[str, Any],
    actor_email: str = "",
    target_type: str = "",
    target_id: str = "",
    caps: Callable[[], Awaitable[CapsVerdict | None]] | None = None,
    approval: ApprovalBinding | None = None,
    approval_id: UUID | None = None,
    idempotency_key: str | None = None,
) -> Dispatch:
    """Check tier, kill switch, caps, unknown outcomes and approval binding
    against current facts, then open an execution record.

    Raises ``RailsDenied`` on a refusal. Exceptions raised by ``caps`` (a
    domain guard's own denial, e.g. ``AdSpendDenied``) propagate unchanged so
    callers keep their audit trail and status codes."""
    store = get_store()
    spec = actions_mod.get(action)
    key = (idempotency_key if idempotency_key is not None else current_idempotency_key()) or None
    row = NewExecution(
        user_id=user_id, action=action, tier=spec.tier if spec else "HIGH",
        principal=principal, args_hash=compute_args_hash(action, args),
        actor_email=actor_email, target_type=target_type, target_id=target_id,
        idempotency_key=key, approval_id=approval_id,
    )

    known = True
    switches: frozenset[str] = frozenset()
    unresolved = False
    if spec is not None:
        try:
            switches = await store.engaged_kill_switches()
            if target_type and target_id:
                unresolved = await store.has_unresolved(user_id, target_type, target_id)
        except Exception:  # noqa: BLE001 - unknown means refuse
            log.error("rails: kill switch / ledger read failed for %s", action, exc_info=True)
            known = False

    caps_verdict = await caps() if (caps is not None and spec is not None and known) else None
    verdict = evaluate(
        DispatchFacts(
            action=spec, kill_switches=switches, kill_switch_known=known,
            caps=caps_verdict, unresolved_on_target=unresolved, approval=approval,
        )
    )
    if not verdict.allowed:
        try:
            await store.record_denied(row, code=verdict.code, reason=verdict.reason)
        except Exception:  # noqa: BLE001 - a denial stands without its record
            log.warning("rails: could not record denial of %s", action, exc_info=True)
        if verdict.code == "approval_args_mismatch" or verdict.code == "approval_governance_changed":
            if approval_id is not None:
                try:
                    await store.expire_approval(user_id, approval_id)
                except Exception:  # noqa: BLE001
                    log.warning("rails: could not expire approval %s", approval_id, exc_info=True)
        raise RailsDenied.from_verdict(verdict)

    claim_key: str | None = None
    try:
        if key:
            prior = await store.find_by_key(user_id, action, key)
            if prior is not None and prior.outcome != "failed":
                raise RailsDenied(
                    "duplicate_dispatch",
                    f"already dispatched under this idempotency key (outcome: {prior.outcome or 'in flight'}); re-read the record",
                    409,
                )
            claim_key = f"rails:{user_id}:{action}:{key}"
            if not await store.claim(claim_key):
                raise RailsDenied("duplicate_dispatch", "a dispatch with this idempotency key is in flight; re-read the record", 409)
        execution_id = await store.start(row)
    except RailsDenied:
        raise
    except Exception as exc:  # noqa: BLE001 - no record, no dispatch
        log.error("rails: could not open execution record for %s", action, exc_info=True)
        if claim_key:
            try:
                await store.release(claim_key)
            except Exception:  # noqa: BLE001
                pass
        raise RailsDenied("rails_unavailable", "rails store unavailable; refusing to act", 503) from exc
    return Dispatch(action=action, user_id=user_id, execution_id=execution_id, claim_key=claim_key)
