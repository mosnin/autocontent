"""Decision log API.

- ``POST /api/v1/decisions/log``  append one decision row for the caller. The
  agent harness logs here best-effort with the service token plus
  ``x-tenant-id`` (see ``backend.auth``); the user is always the authenticated
  tenant, never a body field.
- ``GET  /api/v1/decisions``      the caller's own decisions, newest first,
  keyset-paginated with an opaque ``cursor``.
- ``POST /api/v1/decisions/{id}/outcome``  record what happened afterwards
  (``outcome``) and/or what a person changed (``correction``) on a decision the
  caller owns. 404 for anyone else's id.

The state is never sent here, only its hash. Rows are append-only; outcome
and correction are the only columns that change after the insert.

Abuse bounds: the whole request is capped at 64 KiB by
``backend.security.BodySizeLimitMiddleware`` (before parsing), every field is
length-bounded below, and writes are rate limited per tenant: the agent logs
from one egress, so a per-IP limit would either throttle every tenant together
or bound nothing.
"""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator, model_validator

from marketer.repos import decision_log as decision_log_repo
from marketer.repos.decision_log import DecisionLogEntry

from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

router = APIRouter()

MAX_ANSWERS_BYTES = 32_000
MAX_OUTCOME_BYTES = 8_000
# Per tenant. A busy run makes a few decisions a second at most; anything
# past this is a loop, not a workload.
LOG_RATE_LIMIT = "300/minute"
OUTCOME_RATE_LIMIT = "120/minute"
_IDENT = r"^[a-z0-9][a-z0-9_.:\-]*$"


class DecisionLogIn(BaseModel):
    point: str = Field(min_length=1, max_length=64, pattern=_IDENT)
    mode: Literal["off", "shadow", "enforce"]
    model: str | None = Field(default=None, max_length=128)
    questions_version: str = Field(min_length=1, max_length=64)
    state_hash: str = Field(default="", max_length=128, pattern=r"^[0-9a-fA-F]*$")
    answers: dict[str, Any] | None = None
    fallback_used: bool
    reason: str | None = Field(default=None, max_length=500)
    latency_ms: int = Field(default=0, ge=0, le=600_000)
    cost_usd: Decimal | None = Field(default=None, ge=0, le=100)
    action_taken: str = Field(min_length=1, max_length=64)
    rule_action: str | None = Field(default=None, max_length=64)
    table_action: str | None = Field(default=None, max_length=64)
    subject_kind: str | None = Field(default=None, max_length=32)
    subject_id: str | None = Field(default=None, max_length=128)

    @field_validator("answers")
    @classmethod
    def _bounded(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None and len(json.dumps(v, default=str)) > MAX_ANSWERS_BYTES:
            raise ValueError("answers too large")
        return v


class DecisionLogCreated(BaseModel):
    id: UUID


class DecisionLogPage(BaseModel):
    items: list[DecisionLogEntry]
    next_cursor: str | None


class DecisionOutcomeIn(BaseModel):
    """What happened after the decision. At least one of the two.

    ``outcome``     the later-known truth (engagement, a QA result).
    ``correction``  what a person changed (an override, an edit)."""

    model_config = {"extra": "forbid"}

    outcome: dict[str, Any] | None = None
    correction: dict[str, Any] | None = None

    @field_validator("outcome", "correction")
    @classmethod
    def _bounded(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None and len(json.dumps(v, default=str)) > MAX_OUTCOME_BYTES:
            raise ValueError("too large")
        return v

    @model_validator(mode="after")
    def _one_of(self) -> DecisionOutcomeIn:
        if self.outcome is None and self.correction is None:
            raise ValueError("send outcome, correction, or both")
        return self


class DecisionOutcomeRecorded(BaseModel):
    id: UUID
    ok: bool = True


@router.post(
    "/log",
    response_model=DecisionLogCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[user_rate_limit("decisions.log", LOG_RATE_LIMIT)],
)
async def log_decision(body: DecisionLogIn, ctx: AuthCtx = CurrentUser) -> DecisionLogCreated:
    # Only the agent harness (service token + x-tenant-id) writes here; people
    # and personal tokens read their log but don't author it.
    if not getattr(ctx, "delegated", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "decision logs are written by the agent")
    new_id = await decision_log_repo.insert(user_id=ctx.user_id, **body.model_dump())
    return DecisionLogCreated(id=new_id)


@router.post(
    "/{decision_id}/outcome",
    response_model=DecisionOutcomeRecorded,
    dependencies=[user_rate_limit("decisions.outcome", OUTCOME_RATE_LIMIT)],
)
async def record_decision_outcome(
    decision_id: UUID, body: DecisionOutcomeIn, ctx: AuthCtx = CurrentUser
) -> DecisionOutcomeRecorded:
    """Record an outcome and/or a correction on one of the caller's decisions.

    The row is matched on id AND the authenticated user, so another tenant's
    id answers 404 exactly like an id that does not exist. Both the agent
    (acting for the tenant) and the person may write: the agent knows results,
    the person knows what they overrode. A field left out is left as it was."""
    updated = await decision_log_repo.record_outcome(
        decision_id, user_id=ctx.user_id,
        outcome=body.outcome, correction=body.correction,
    )
    if not updated:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "decision not found")
    return DecisionOutcomeRecorded(id=decision_id)


@router.get("", response_model=DecisionLogPage)
async def list_decisions(
    ctx: AuthCtx = CurrentUser,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, max_length=200),
    point: str | None = Query(default=None, max_length=64, pattern=_IDENT),
) -> DecisionLogPage:
    before: tuple[datetime, UUID] | None = None
    if cursor:
        try:
            before = decision_log_repo.decode_cursor(cursor)
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid cursor") from e
    # One extra row tells us whether another page exists.
    rows = await decision_log_repo.list_for_user(
        ctx.user_id, limit=limit + 1, before=before, point=point
    )
    page, more = rows[:limit], len(rows) > limit
    next_cursor = (
        decision_log_repo.encode_cursor(page[-1].created_at, page[-1].id) if more else None
    )
    return DecisionLogPage(items=page, next_cursor=next_cursor)
