"""Write security events to ``public.security_audit_log`` from request paths.

Auditing must never change an outcome: a failed or slow write is logged and
dropped, so it can neither turn a deny into an allow nor hold the response
for long (bounded wait).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from marketer.repos import security_audit

from .auth import AuthCtx

log = logging.getLogger(__name__)

AUDIT_TIMEOUT_SEC = 1.0


def actor_type_of(ctx: AuthCtx) -> str:
    if ctx.delegated:
        return "agent"
    if ctx.actor_type in security_audit.ACTOR_TYPES:
        return ctx.actor_type
    return "user"


async def record(
    ctx: AuthCtx | None,
    action: str,
    *,
    outcome: str,
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    actor_type: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Best effort, bounded. Never raises."""
    try:
        kw: dict[str, Any] = dict(
            action=action,
            outcome=outcome,
            target_type=target_type,
            target_id=target_id,
            metadata=metadata or {},
        )
        if ctx is not None:
            kw.update(
                org_id=ctx.org_id or None,
                tenant_id=ctx.user_id or None,
                actor_id=ctx.actor_id or None,
                actor_email=ctx.actor_email or ctx.email or "",
                actor_type=actor_type or actor_type_of(ctx),
                ip=ip if ip is not None else (ctx.ip or None),
                user_agent=user_agent if user_agent is not None else (ctx.user_agent or None),
            )
            if ctx.delegated:
                kw["metadata"] = {**kw["metadata"], "delegated": True, "role": ctx.role}
        else:
            kw.update(actor_type=actor_type or "system", ip=ip, user_agent=user_agent)
        await asyncio.wait_for(security_audit.insert(**kw), timeout=AUDIT_TIMEOUT_SEC)
    except Exception:  # noqa: BLE001 — auditing never changes the outcome
        log.warning("security_audit.write_failed action=%s", action, exc_info=True)
