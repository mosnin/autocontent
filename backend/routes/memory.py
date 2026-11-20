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

Recall (Supermemory, docs/memory/supermemory.md), at the end of this module:

- ``/recall/settings``: read by any member; changed only with security:manage.
- ``/recall/session``: the agent asks, at session start, whether recall is on
  (and registers the person it acts for, so the purge job knows the namespace).
- ``/personal*``: the caller's OWN personal memory. The namespace comes from
  ``ctx.user_id`` + ``ctx.actor_id``; no route takes a namespace or a person id,
  so nobody (owner, admin, the agent) can reach another person's memory.
- ``/team*``: list with memory:read, forget with memory:forget (person only).
- Confirming a fact mirrors it into team memory; correcting or forgetting it
  removes the mirror (best effort; the scheduler tick reconciles).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.recall import repo as recall_repo
from marketer.recall import service as recall_service
from marketer.repos import memory as memory_repo
from marketer.services.supermemory import SupermemoryError
from marketer.repos.memory import AuditEntry, Fact, Learning, MemoryRejected, WriteOutcome

from .. import audit
from ..auth import AuthCtx, CurrentUser
from ..policy import require_permission
from ..security import user_rate_limit

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
async def confirm_fact(fact_id: UUID, background: BackgroundTasks, ctx: AuthCtx = CurrentUser) -> Fact:
    _person_only(ctx)
    fact = await memory_repo.confirm_fact(ctx.user_id, fact_id)
    if fact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fact not found")
    background.add_task(recall_service.mirror_fact, ctx.user_id, fact)
    return fact


@router.post("/facts/{fact_id}/correct", response_model=WriteOutcome)
async def correct_fact(fact_id: UUID, body: CorrectIn, background: BackgroundTasks, ctx: AuthCtx = CurrentUser) -> WriteOutcome:
    _person_only(ctx)
    try:
        outcome = await memory_repo.correct_fact(
            ctx.user_id, fact_id, value=body.value, object=body.object.model_dump() if body.object else None
        )
    except MemoryRejected as e:
        raise _rejected(e) from e
    if outcome is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fact not found")
    background.add_task(_remirror, ctx.user_id, fact_id, outcome.fact)
    return outcome


async def _remirror(tenant_id: str, old_id: UUID, new_fact: Fact | None) -> None:
    await recall_service.unmirror_fact(tenant_id, old_id)
    await recall_service.mirror_fact(tenant_id, new_fact)


@router.post("/facts/{fact_id}/forget", status_code=status.HTTP_204_NO_CONTENT)
async def forget_fact(fact_id: UUID, background: BackgroundTasks, ctx: AuthCtx = CurrentUser) -> None:
    _person_only(ctx)
    if not await memory_repo.forget_fact(ctx.user_id, fact_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fact not found")
    background.add_task(recall_service.unmirror_fact, ctx.user_id, fact_id)


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


# --------------------------------------------------------------------------- recall (Supermemory)


class RecallSettings(BaseModel):
    configured: bool
    enabled: bool
    updated_at: datetime | None = None


class RecallSettingsIn(BaseModel):
    enabled: bool
    # Turning recall off can also delete every namespace of the workspace.
    delete_data: bool = False


class RecallSettingsOut(RecallSettings):
    queued_deletes: int = 0


class RecallSession(BaseModel):
    """What the agent learns at session start. No namespace: the agent derives
    its own from its verified session token."""

    enabled: bool
    personal: bool


class RecallItem(BaseModel):
    id: str
    memory: str
    updated_at: str | None = None


class RecallPage(BaseModel):
    enabled: bool
    items: list[RecallItem]
    total: int
    page: int


class ForgetPreviewIn(BaseModel):
    query: str = Field(min_length=2, max_length=500)


class ForgetIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class ForgetPreview(BaseModel):
    matches: list[RecallItem]


class Forgotten(BaseModel):
    forgotten: int
    failed: int


_MEM_ID = r"^[A-Za-z0-9_:.\-]{1,128}$"


def _clean_ids(ids: list[str]) -> list[str]:
    import re

    out = [i for i in dict.fromkeys(ids) if isinstance(i, str) and re.match(_MEM_ID, i)]
    if len(out) != len(set(ids)):
        raise HTTPException(422, "invalid memory id")
    return out


def _require_session_person(ctx: AuthCtx) -> None:
    """Personal memory belongs to a signed-in person: never the agent (it reads
    its own way, for the person it acts for), never a personal access token
    (a credential that outlives the session must not open someone's memory)."""
    if getattr(ctx, "delegated", False) or ctx.actor_type != "user" or not ctx.actor_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "personal memory is only available to the signed-in person")


def _unavailable(e: Exception) -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "recall is temporarily unavailable")


async def _setting(ctx: AuthCtx) -> RecallSettings:
    try:
        s = await recall_repo.get_setting(ctx.user_id)
    except Exception as e:  # noqa: BLE001 — no answer means off, surfaced as 503
        raise _unavailable(e) from None
    return RecallSettings(configured=recall_service.configured(), enabled=s.enabled, updated_at=s.updated_at)


def _items(items) -> list[RecallItem]:
    return [RecallItem(id=m.id, memory=m.memory, updated_at=m.updated_at) for m in items]


@router.get("/recall/settings", response_model=RecallSettings)
async def recall_settings(ctx: AuthCtx = CurrentUser) -> RecallSettings:
    return await _setting(ctx)


@router.put("/recall/settings", response_model=RecallSettingsOut)
async def update_recall_settings(body: RecallSettingsIn, background: BackgroundTasks, ctx: AuthCtx = CurrentUser) -> RecallSettingsOut:
    """security:manage (policy), a person only. On: seed team memory. Off:
    reads and writes stop; with ``delete_data`` every namespace of the
    workspace is queued for deletion."""
    _person_only(ctx)
    if body.enabled and not recall_service.configured():
        raise HTTPException(status.HTTP_409_CONFLICT, "recall is not configured on this deployment")
    try:
        s = await recall_repo.set_setting(ctx.user_id, body.enabled)
        queued = 0
        if not body.enabled and body.delete_data:
            queued = await recall_service.enqueue_workspace(ctx.user_id, "recall.disabled")
    except Exception as e:  # noqa: BLE001
        raise _unavailable(e) from None
    await audit.record(
        ctx, "memory.recall_setting", outcome="success", target_type="workspace",
        metadata={"enabled": body.enabled, "delete_data": bool(body.delete_data and not body.enabled), "queued": queued},
    )
    if body.enabled:
        background.add_task(recall_service.sync_team, ctx.user_id)
    return RecallSettingsOut(configured=recall_service.configured(), enabled=s.enabled, updated_at=s.updated_at, queued_deletes=queued)


@router.get("/recall/session", response_model=RecallSession)
async def recall_session(ctx: AuthCtx = CurrentUser) -> RecallSession:
    """The agent only (agent:chat via policy). ``personal`` is true when the
    backend verified the person in ``x-actor-id``; only then may the agent read
    or write their personal memory. Off (or any doubt) means no recall."""
    if not getattr(ctx, "delegated", False):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "agent only")
    try:
        on = await recall_service.enabled(ctx.user_id)
        personal = bool(on and ctx.actor_id)
        if personal:
            await recall_repo.register_subject(ctx.user_id, ctx.actor_id, ctx.org_id or None)
    except Exception as e:  # noqa: BLE001 — the agent treats any failure as off
        raise _unavailable(e) from None
    return RecallSession(enabled=on, personal=personal)


@router.get("/personal", response_model=RecallPage)
async def list_personal(ctx: AuthCtx = CurrentUser, page: int = Query(default=1, ge=1, le=1000), limit: int = Query(default=50, ge=1, le=100)) -> RecallPage:
    _require_session_person(ctx)
    setting = await _setting(ctx)
    target = recall_service.personal_scope(ctx)
    if not (setting.configured and setting.enabled) or target is None:
        return RecallPage(enabled=False, items=[], total=0, page=page)
    try:
        items, total = await recall_service.client().list_memories(target, page=page, limit=limit)
    except SupermemoryError as e:
        raise _unavailable(e) from None
    return RecallPage(enabled=True, items=_items(items), total=total, page=page)


@router.post("/personal/forget/preview", response_model=ForgetPreview, dependencies=[user_rate_limit("memory.forget_preview", "20/minute")])
async def preview_forget_personal(body: ForgetPreviewIn, ctx: AuthCtx = CurrentUser) -> ForgetPreview:
    """Semantic dry run: which of MY memories match. Changes nothing."""
    _require_session_person(ctx)
    target = recall_service.personal_scope(ctx)
    if not recall_service.configured() or target is None:
        return ForgetPreview(matches=[])
    try:
        result = await recall_service.client().forget_preview(target, body.query)
    except SupermemoryError as e:
        if e.not_found:
            return ForgetPreview(matches=[])
        raise _unavailable(e) from None
    return ForgetPreview(matches=_items(result.matches))


@router.post("/personal/forget", response_model=Forgotten, dependencies=[user_rate_limit("memory.forget", "20/minute")])
async def forget_personal(body: ForgetIn, ctx: AuthCtx = CurrentUser) -> Forgotten:
    """Forget exact memories by id, in MY namespace only. Works while recall is
    off too: forgetting is never blocked. An id from another namespace is not
    found there, so it forgets nothing."""
    _require_session_person(ctx)
    ids = _clean_ids(body.ids)
    target = recall_service.personal_scope(ctx)
    if not recall_service.configured() or target is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "recall is not configured on this deployment")
    try:
        result = await recall_service.client().forget(target, ids)
    except SupermemoryError as e:
        if e.not_found:
            return Forgotten(forgotten=0, failed=len(ids))
        raise _unavailable(e) from None
    await audit.record(ctx, "memory.forget", outcome="success", target_type="recall_personal", metadata={"kind": "personal", "count": result.count, "failed": result.errors})
    return Forgotten(forgotten=result.count, failed=result.errors)


@router.get("/personal/export", dependencies=[user_rate_limit("memory.export", "5/minute")])
async def export_personal(ctx: AuthCtx = CurrentUser) -> dict[str, Any]:
    """Privacy export of MY personal memories (every page)."""
    _require_session_person(ctx)
    target = recall_service.personal_scope(ctx)
    if not recall_service.configured() or target is None:
        return {"scope": "personal", "configured": False, "memories": []}
    try:
        memories = await export_scope(target)
    except SupermemoryError as e:
        raise _unavailable(e) from None
    return {"scope": "personal", "configured": True, "memories": memories}


async def export_scope(target, max_pages: int = 50) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    sm = recall_service.client()
    for page in range(1, max_pages + 1):
        items, total = await sm.list_memories(target, page=page, limit=100)
        out.extend({"id": m.id, "memory": m.memory, "updated_at": m.updated_at} for m in items)
        if not items or len(out) >= total:
            break
    return out


@router.get("/team", response_model=RecallPage)
async def list_team(ctx: AuthCtx = CurrentUser, page: int = Query(default=1, ge=1, le=1000), limit: int = Query(default=50, ge=1, le=100)) -> RecallPage:
    """memory:read (policy)."""
    setting = await _setting(ctx)
    target = recall_service.team_scope(ctx.user_id)
    if not (setting.configured and setting.enabled) or target is None:
        return RecallPage(enabled=False, items=[], total=0, page=page)
    try:
        items, total = await recall_service.client().list_memories(target, page=page, limit=limit)
    except SupermemoryError as e:
        raise _unavailable(e) from None
    return RecallPage(enabled=True, items=_items(items), total=total, page=page)


@router.post("/team/forget/preview", response_model=ForgetPreview, dependencies=[user_rate_limit("memory.forget_preview", "20/minute")])
async def preview_forget_team(body: ForgetPreviewIn, ctx: AuthCtx = CurrentUser) -> ForgetPreview:
    """memory:forget (policy), a person only."""
    _person_only(ctx)
    target = recall_service.team_scope(ctx.user_id)
    if not recall_service.configured() or target is None:
        return ForgetPreview(matches=[])
    try:
        result = await recall_service.client().forget_preview(target, body.query)
    except SupermemoryError as e:
        if e.not_found:
            return ForgetPreview(matches=[])
        raise _unavailable(e) from None
    return ForgetPreview(matches=_items(result.matches))


@router.post("/team/forget", response_model=Forgotten, dependencies=[user_rate_limit("memory.forget", "20/minute")])
async def forget_team(body: ForgetIn, ctx: AuthCtx = CurrentUser) -> Forgotten:
    """memory:forget (policy), a person only."""
    _person_only(ctx)
    ids = _clean_ids(body.ids)
    target = recall_service.team_scope(ctx.user_id)
    if not recall_service.configured() or target is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "recall is not configured on this deployment")
    try:
        result = await recall_service.client().forget(target, ids)
    except SupermemoryError as e:
        if e.not_found:
            return Forgotten(forgotten=0, failed=len(ids))
        raise _unavailable(e) from None
    await audit.record(ctx, "memory.forget", outcome="success", target_type="recall_team", metadata={"kind": "team", "count": result.count, "failed": result.errors})
    return Forgotten(forgotten=result.count, failed=result.errors)
