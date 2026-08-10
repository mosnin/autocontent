"""The wired Gatekeeper: DB-backed intent store and audit sink.

Kept apart from `broker.py` so the core stays importable and testable
without a database. This module is the only place the two halves meet.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from ..repos import gatekeeper as repo
from .broker import Gatekeeper
from .capability import Decision, GatekeeperContext


class DbIntentStore:
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
        row = await repo.record_intent(
            user_id=ctx.user_id,
            capability=capability,
            summary=summary,
            params=params,
            simulated=simulated,
            reason=decision.reason,
            dollar_delta=decision.dollar_delta,
            evidence=decision.evidence,
            actor=ctx.actor,
            origin=ctx.origin,
        )
        return str(row["id"])


class DbAuditSink:
    async def write(
        self,
        *,
        capability: str,
        verdict: str,
        summary: str,
        reason: str,
        ctx: GatekeeperContext,
        intent_id: str | None,
    ) -> None:
        await repo.write_audit(
            user_id=ctx.user_id,
            capability=capability,
            verdict=verdict,
            summary=summary,
            reason=reason,
            actor=ctx.actor,
            origin=ctx.origin,
            intent_id=UUID(intent_id) if intent_id else None,
        )


def production_gatekeeper() -> Gatekeeper:
    """The instance every route and pipeline should use."""
    return Gatekeeper(intents=DbIntentStore(), audit=DbAuditSink())
