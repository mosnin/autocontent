"""The approval inbox — `/api/v1/gatekeeper`.

Speculative execution moves the human out of the agent's critical path,
which only works if reviewing what the agent queued is genuinely fast.
That makes this surface, not the agent, the product's real control
plane — so bulk decide is first-class rather than a convenience, and every
intent carries the sentence and the simulated diff an approver needs to
decide without opening anything else.

Everything is user-scoped. Applying happens on a Modal cron, never
in-request: a bulk approval of twenty campaign changes must not depend on
a browser tab staying open.
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.repos import gatekeeper as repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

# Bulk is the point, but an unbounded id list is a denial-of-service on our
# own database. 200 is far above any real review session.
MAX_BULK = 200


class DecideBody(BaseModel):
    approved: bool


class BulkDecideBody(BaseModel):
    intent_ids: list[UUID] = Field(min_length=1, max_length=MAX_BULK)
    approved: bool


@router.get("/intents")
async def list_intents(
    ctx: AuthCtx = CurrentUser,
    status_filter: Literal[
        "pending", "approved", "rejected", "applied", "failed", "expired"
    ]
    | None = None,
    capability: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    return await repo.list_intents(
        ctx.user_id, status=status_filter, capability=capability, limit=limit
    )


@router.get("/intents/{intent_id}")
async def get_intent(intent_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    intent = await repo.get_intent(intent_id, user_id=ctx.user_id)
    if intent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return intent


@router.post("/intents/{intent_id}/decide")
async def decide_intent(
    intent_id: UUID, body: DecideBody, ctx: AuthCtx = CurrentUser
) -> dict:
    decided = await repo.decide(
        intent_id, user_id=ctx.user_id, approved=body.approved, decided_by=ctx.user_id
    )
    if decided is not None:
        return decided

    # The claim is atomic, so a miss means either "not yours" or "already
    # decided" — and those must read differently. A 409 tells an operator
    # their click lost a race; a 404 would suggest the intent never existed.
    existing = await repo.get_intent(intent_id, user_id=ctx.user_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        detail=f"intent is already {existing['status']}, not pending",
    )


@router.post("/intents/decide")
async def decide_many(body: BulkDecideBody, ctx: AuthCtx = CurrentUser) -> dict:
    """Bulk decide. Rows that are no longer pending are skipped rather than
    failing the batch — one already-decided intent must not cost an
    operator the other nineteen decisions they just made."""
    decided = await repo.decide_many(
        body.intent_ids,
        user_id=ctx.user_id,
        approved=body.approved,
        decided_by=ctx.user_id,
    )
    decided_ids = {str(row["id"]) for row in decided}
    return {
        "decided": len(decided),
        "skipped": [str(i) for i in body.intent_ids if str(i) not in decided_ids],
        "intents": decided,
    }


@router.get("/audit")
async def list_audit(
    ctx: AuthCtx = CurrentUser,
    capability: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[dict]:
    return await repo.list_audit(ctx.user_id, capability=capability, limit=limit)
