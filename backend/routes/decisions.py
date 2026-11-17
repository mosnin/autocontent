"""Decision log API.

- ``POST /api/v1/decisions/log``  append one decision row for the caller. The
  agent harness logs here best-effort with the service token plus
  ``x-tenant-id`` (see ``backend.auth``); the user is always the authenticated
  tenant, never a body field.
- ``GET  /api/v1/decisions``      the caller's own decisions, newest first,
  keyset-paginated with an opaque ``cursor``.

The state is never sent here, only its hash. Rows are append-only; outcomes
and corrections are filled in later by the pipelines.
"""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from marketer.repos import decision_log as decision_log_repo
from marketer.repos.decision_log import DecisionLogEntry

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

MAX_ANSWERS_BYTES = 32_000
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


@router.post("/log", response_model=DecisionLogCreated, status_code=status.HTTP_201_CREATED)
async def log_decision(body: DecisionLogIn, ctx: AuthCtx = CurrentUser) -> DecisionLogCreated:
    # Only the agent harness (service token + x-tenant-id) writes here; people
    # and personal tokens read their log but don't author it.
    if not getattr(ctx, "delegated", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "decision logs are written by the agent")
    new_id = await decision_log_repo.insert(user_id=ctx.user_id, **body.model_dump())
    return DecisionLogCreated(id=new_id)


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
