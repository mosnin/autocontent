"""Memory API: what Marketer knows about the caller's account.

Facts (``/api/v1/memory/facts``) carry their source, a trust level and a
validity window; learnings (``/api/v1/memory/learnings``) carry their
evidence. The rules are in ``marketer.repos.memory`` and ``docs/memory/``.

Who may do what:

- The tenant is always the authenticated user (``ctx.user_id``). No path, query
  or body field names a user; another user's fact id is a 404.
- The agent (service token + ``x-tenant-id``, ``ctx.delegated``) may read, write
  facts from non-person sources, record learnings and merge exact duplicates.
  Its facts are never ``trusted``.
- Route permissions (backend/policy.py): reads need memory:read; confirm and
  correct memory:confirm; forget memory:forget; writes memory:confirm for a
  person and agent:chat for the agent.
- Only a signed-in person may confirm, correct or forget a fact. Those routes
  refuse the agent, so nothing a model reads can promote a fact to a brand rule
  or erase one.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.repos import memory as memory_repo
from marketer.repos.memory import AuditEntry, Fact, Learning, MemoryRejected, WriteOutcome

from ..auth import AuthCtx, CurrentUser
from ..policy import require_permission

router = APIRouter()

_ENTITY = "|".join(memory_repo.ENTITY_TYPES)


class EntityIn(BaseModel):
    type: str = Field(max_length=32)
    name: str = Field(max_length=memory_repo.MAX_NAME)


class SourceIn(BaseModel):
    kind: Literal["person", "message", "approval", "job", "metric", "tool", "document", "web"]
    ref: str = Field(max_length=memory_repo.MAX_REF)
    at: datetime | None = None
    excerpt: str | None = Field(default=None, max_length=2000)


class FactIn(BaseModel):
    subject: EntityIn
    predicate: str = Field(max_length=64)
    value: str | None = Field(default=None, max_length=memory_repo.MAX_VALUE)
    object: EntityIn | None = None
    source: SourceIn | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class CorrectIn(BaseModel):
    value: str | None = Field(default=None, max_length=memory_repo.MAX_VALUE)
    object: EntityIn | None = None


class LearningIn(BaseModel):
    claim: str = Field(max_length=memory_repo.MAX_CLAIM)
    status: Literal["hypothesis", "supported", "refuted"] = "hypothesis"
    evidence: list[dict[str, Any]] = Field(max_length=memory_repo.MAX_EVIDENCE_ITEMS)
    confidence: float | None = Field(default=None, ge=0, le=1)


class LearningStatusIn(BaseModel):
    status: Literal["hypothesis", "supported", "refuted"]
    evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=memory_repo.MAX_EVIDENCE_ITEMS)


class MergeIn(BaseModel):
    keep: UUID
    drop: list[UUID] = Field(min_length=1, max_length=50)


class FactPage(BaseModel):
    items: list[Fact]
    counts: dict[str, int]
    limits: dict[str, int]


class FactList(BaseModel):
    items: list[Fact]


class LearningList(BaseModel):
    items: list[Learning]


class AuditList(BaseModel):
    items: list[AuditEntry]


class Merged(BaseModel):
    merged: int


def _actor(ctx: AuthCtx) -> Literal["person", "agent"]:
    return "agent" if getattr(ctx, "delegated", False) else "person"


def _person_only(ctx: AuthCtx) -> None:
    if getattr(ctx, "delegated", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the account owner can change what memory holds")


async def _require_write(ctx: AuthCtx) -> None:
    """backend/policy.py: InRoute. A person adds to memory with memory:confirm
    (what they write is trusted); the agent records what it learned as part
    of working with the person (agent:chat, capped by the person's role), and
    its facts are never trusted."""
    await require_permission(
        ctx, "agent:chat" if getattr(ctx, "delegated", False) else "memory:confirm"
    )


def _rejected(e: MemoryRejected) -> HTTPException:
    return HTTPException(422, f"{e.reason}: {e.detail}")


@router.get("/facts", response_model=FactPage)
async def list_facts(
    ctx: AuthCtx = CurrentUser,
    state: Literal["current", "pending", "active", "all"] = Query(default="current"),
    entity_type: str | None = Query(default=None, pattern=f"^({_ENTITY})$"),
    limit: int = Query(default=200, ge=1, le=500),
) -> FactPage:
    items = await memory_repo.list_facts(ctx.user_id, state=state, entity_type=entity_type, limit=limit)
    return FactPage(
        items=items,
        counts=await memory_repo.fact_counts(ctx.user_id),
        limits={"active": memory_repo.MAX_ACTIVE_FACTS, "value_chars": memory_repo.MAX_VALUE},
    )


@router.post("/facts", response_model=WriteOutcome)
async def write_fact(body: FactIn, ctx: AuthCtx = CurrentUser) -> WriteOutcome:
    await _require_write(ctx)
    actor = _actor(ctx)
    # A person writing in the app is the source; the agent must name one and
    # can never claim to be the person.
    if actor == "person":
        source = SourceIn(kind="person", ref="memory-page")
    elif body.source is None or body.source.kind == "person":
        raise HTTPException(422, "invalid_source: the agent must name a non-person source")
    else:
        source = body.source
    try:
        fact = memory_repo.validate_fact(
            subject=body.subject.model_dump(),
            predicate=body.predicate,
            value=body.value,
            object=body.object.model_dump() if body.object else None,
            source_kind=source.kind,
            source_ref=source.ref,
            source_at=source.at,
            source_excerpt=source.excerpt,
            confidence=body.confidence if actor == "agent" else None,
        )
        return await memory_repo.write_fact(ctx.user_id, fact, actor=actor)
    except MemoryRejected as e:
        raise _rejected(e) from e


@router.get("/facts/{fact_id}/history", response_model=FactList)
async def fact_history(fact_id: UUID, ctx: AuthCtx = CurrentUser) -> FactList:
    items = await memory_repo.fact_history(ctx.user_id, fact_id)
    if not items:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fact not found")
    return FactList(items=items)


@router.post("/facts/{fact_id}/confirm", response_model=Fact)
async def confirm_fact(fact_id: UUID, ctx: AuthCtx = CurrentUser) -> Fact:
    _person_only(ctx)
    fact = await memory_repo.confirm_fact(ctx.user_id, fact_id)
    if fact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fact not found")
    return fact


@router.post("/facts/{fact_id}/correct", response_model=WriteOutcome)
async def correct_fact(fact_id: UUID, body: CorrectIn, ctx: AuthCtx = CurrentUser) -> WriteOutcome:
    _person_only(ctx)
    try:
        outcome = await memory_repo.correct_fact(
            ctx.user_id, fact_id, value=body.value, object=body.object.model_dump() if body.object else None
        )
    except MemoryRejected as e:
        raise _rejected(e) from e
    if outcome is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fact not found")
    return outcome


@router.post("/facts/{fact_id}/forget", status_code=status.HTTP_204_NO_CONTENT)
async def forget_fact(fact_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    _person_only(ctx)
    if not await memory_repo.forget_fact(ctx.user_id, fact_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fact not found")


@router.post("/facts/merge", response_model=Merged)
async def merge_facts(body: MergeIn, ctx: AuthCtx = CurrentUser) -> Merged:
    """Consolidation: fold exact duplicates into one. The repo only touches
    rows with the same slot and content as ``keep``."""
    await _require_write(ctx)
    actor = "system" if getattr(ctx, "delegated", False) else "person"
    return Merged(merged=await memory_repo.merge_duplicates(ctx.user_id, body.keep, body.drop, actor=actor))


@router.get("/learnings", response_model=LearningList)
async def list_learnings(
    ctx: AuthCtx = CurrentUser,
    status_: Literal["hypothesis", "supported", "refuted"] | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> LearningList:
    return LearningList(items=await memory_repo.list_learnings(ctx.user_id, status=status_, limit=limit))


@router.post("/learnings", response_model=Learning, status_code=status.HTTP_201_CREATED)
async def record_learning(body: LearningIn, ctx: AuthCtx = CurrentUser) -> Learning:
    await _require_write(ctx)
    actor = _actor(ctx)
    try:
        claim, evidence = memory_repo.validate_learning(claim=body.claim, status=body.status, evidence=body.evidence)
    except MemoryRejected as e:
        raise _rejected(e) from e
    learning = await memory_repo.record_learning(
        ctx.user_id, claim=claim, status=body.status, evidence=evidence, confidence=body.confidence,
        source="person" if actor == "person" else "analyst", actor=actor,
    )
    if learning is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "this account's learnings are full")
    return learning


@router.post("/learnings/{learning_id}/status", response_model=Learning)
async def set_learning_status(learning_id: UUID, body: LearningStatusIn, ctx: AuthCtx = CurrentUser) -> Learning:
    await _require_write(ctx)
    try:
        extra = memory_repo.validate_evidence(body.evidence) if body.evidence else []
        learning = await memory_repo.set_learning_status(
            ctx.user_id, learning_id, status=body.status, add_evidence=extra, actor=_actor(ctx)
        )
    except MemoryRejected as e:
        raise _rejected(e) from e
    if learning is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "learning not found")
    return learning


@router.get("/audit", response_model=AuditList)
async def list_audit(ctx: AuthCtx = CurrentUser, limit: int = Query(default=50, ge=1, le=200)) -> AuditList:
    return AuditList(items=await memory_repo.list_audit(ctx.user_id, limit=limit))
