"""The workspace's security audit log (``audit:read``).

GET /api/v1/audit-log?limit=50&before=<id>  newest first, paged by id.

Only the caller's workspace: rows whose org id is the caller's workspace or
whose tenant id is the caller's tenant. Nothing in the request names a
workspace.
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from marketer.repos import security_audit
from marketer.repos.security_audit import SecurityAuditEntry

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

MAX_PAGE = 200


class AuditLogPage(BaseModel):
    items: list[SecurityAuditEntry]
    # Pass as ?before= to get the next (older) page; null on the last page.
    next_before: int | None = None


@router.get("", response_model=AuditLogPage)
async def list_audit_log(
    ctx: AuthCtx = CurrentUser,
    limit: int = Query(default=50, ge=1, le=MAX_PAGE),
    before: int | None = Query(default=None, ge=1),
) -> AuditLogPage:
    items = await security_audit.list_for_org(
        ctx.org_id or None, ctx.user_id or None, limit=limit, before_id=before
    )
    next_before = items[-1].id if len(items) == limit else None
    return AuditLogPage(items=items, next_before=next_before)
