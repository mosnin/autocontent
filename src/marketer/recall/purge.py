"""Recall lifecycle job (docs/memory/supermemory.md, "Lifecycle").

One pass (``run_once``), called by the scheduler (modal_app.py ``recall_tick``):

1. **Consume** new rows of ``security_audit_log`` (cursor in
   ``recall_audit_cursor``) and queue namespace deletes:

   - ``member.removed`` / ``member.left`` for workspace X: every known personal
     subject of X whom the auth schema says is no longer a member. (Web's row
     names the member id, which is gone once the member row is deleted, so we
     ask the auth schema instead of trusting the row's target.)
   - ``platform.user_removed`` (account deleted): every known subject of that
     person, once the auth schema confirms the person is gone.
   - ``workspace.deleted`` for X: the team namespace and every known personal
     namespace of X's tenant, once the auth schema confirms X is gone.

   Account erasure (``DELETE /api/v1/users/me``) and the off switch with
   "delete data" queue directly.

   If the auth schema cannot answer, the cursor does not move and the pass
   stops: the same rows are read again next time (fail closed, nothing lost).

2. **Drain** the queue: delete each namespace. Done only when Supermemory
   confirms (200, or 404 = never existed); anything else stays pending with
   exponential backoff. Idempotent: one pending row per namespace.

3. **Audit**: one ``memory.purge`` row per confirmed delete, with the namespace
   kind, the reason and counts only.
"""
from __future__ import annotations

import logging
from typing import Any

from marketer.recall import repo, service
from marketer.repos import security_audit
from marketer.services.supermemory import SupermemoryError

log = logging.getLogger(__name__)

AUDIT_BATCH = 200
DRAIN_BATCH = 50


async def _queue_for_event(row: dict[str, Any]) -> int:
    action = row["action"]
    org_id = row.get("org_id") or ""
    queued = 0
    if action in ("member.removed", "member.left"):
        candidates = await repo.subjects_for_org(org_id) if org_id else []
        if action == "member.left" and row.get("actor_id") and row.get("tenant_id"):
            candidates.append((row["tenant_id"], row["actor_id"]))
        for tenant_id, person_id in candidates:
            member = await repo.is_member(tenant_id, person_id)
            if member is False:
                queued += int(await repo.enqueue("personal", tenant_id, person_id, action))
    elif action == "platform.user_removed":
        person = row.get("target_id") or ""
        if person and not await repo.person_exists(person):
            for tenant_id in await repo.subjects_for_person(person):
                queued += int(await repo.enqueue("personal", tenant_id, person, "account.deleted"))
    elif action == "workspace.deleted":
        if org_id and not await repo.org_exists(org_id):
            for tenant_id in await repo.tenants_for_org(org_id):
                queued += await service.enqueue_workspace(tenant_id, "workspace.deleted")
    return queued


async def consume_audit() -> dict[str, int]:
    """Step 1. Stops at the first row the auth schema can't answer for."""
    cursor = await repo.get_cursor()
    rows = await repo.audit_rows_after(cursor, AUDIT_BATCH)
    seen = queued = 0
    for row in rows:
        try:
            queued += await _queue_for_event(row)
        except Exception:  # noqa: BLE001 — retry this row next pass; never skip it
            log.warning("recall.purge.consume_stalled at=%s action=%s", row["id"], row["action"])
            break
        await repo.set_cursor(row["id"])
        seen += 1
    return {"events": seen, "queued": queued}


async def drain() -> dict[str, int]:
    """Step 2 and 3."""
    done = failed = 0
    if not service.configured():
        # No key: nothing can be confirmed, so everything stays pending.
        return {"done": 0, "failed": 0, "pending": await repo.pending_count()}
    sm = service.client()
    for row in await repo.due(DRAIN_BATCH):
        target = service.team_scope(row.tenant_id) if row.kind == "team" else service.subject_scope(row.tenant_id, row.person_id or "")
        if target is None:
            await repo.mark_failed(row, "refused_id")
            failed += 1
            continue
        try:
            result = await sm.delete_namespace(target)
        except SupermemoryError as e:
            await repo.mark_failed(row, f"{e.kind}:{e.status}")
            failed += 1
            continue
        await repo.mark_done(row)
        done += 1
        try:
            await security_audit.insert(
                action="memory.purge",
                actor_type="system",
                outcome="success",
                tenant_id=row.tenant_id,
                target_type=f"recall_{row.kind}",
                metadata={
                    "kind": row.kind,
                    "reason": row.reason,
                    "documents": result.documents,
                    "memories": result.memories,
                    "existed": result.existed,
                    "attempts": row.attempts + 1,
                },
            )
        except Exception:  # noqa: BLE001 — the delete happened; the audit row is best effort
            log.warning("recall.purge.audit_failed")
    return {"done": done, "failed": failed, "pending": await repo.pending_count()}


async def sync_enabled(limit: int = 50) -> dict[str, int]:
    """Team mirroring for every enabled workspace (changes only)."""
    totals = {"tenants": 0, "added": 0, "removed": 0, "failed": 0}
    if not service.configured():
        return totals
    for tenant_id in await repo.enabled_tenants(limit):
        try:
            counts = await service.sync_team(tenant_id)
        except Exception:  # noqa: BLE001 — one workspace never stops the others
            totals["failed"] += 1
            continue
        totals["tenants"] += 1
        for k in ("added", "removed", "failed"):
            totals[k] += counts[k]
    return totals


async def run_once() -> dict[str, Any]:
    consumed = await consume_audit()
    drained = await drain()
    mirrored = await sync_enabled()
    return {"consume": consumed, "drain": drained, "mirror": mirrored}
