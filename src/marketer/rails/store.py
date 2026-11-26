"""Persistence for the rails (db/migrations/0027_rails.sql).

Two implementations of one small interface:

- ``PostgresRailsStore`` (default): ``rails_executions`` for outcomes,
  ``feature_flags`` for the global kill switches, ``idempotency_keys`` (0024)
  for exactly-once claims on agent idempotency keys.
- ``InMemoryRailsStore``: the same semantics in a dict, for unit tests and
  route tests that stub the database (tests/conftest.py installs it).

``set_store`` swaps the active store; nothing else should hold a reference.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol
from uuid import UUID

# Feature-flag keys for the global kill switches (admin feature flags page).
KILL_SWITCH_FLAGS: dict[str, str] = {
    "rails.kill_switch.all": "all",
    "rails.kill_switch.publish": "publish",
    "rails.kill_switch.spend": "spend",
}
# A row still 'dispatching' after this long lost its process mid-send: its
# outcome is unknown, so it counts as indeterminate.
STALE_DISPATCH_MINUTES = 15
CLAIM_TTL_SECONDS = 24 * 60 * 60


@dataclass
class NewExecution:
    user_id: str
    action: str
    tier: str
    principal: str
    args_hash: str
    actor_email: str = ""
    target_type: str = ""
    target_id: str = ""
    idempotency_key: str | None = None
    approval_id: UUID | None = None
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class ExecutionRow:
    id: UUID
    user_id: str
    action: str
    tier: str
    principal: str
    args_hash: str
    target_type: str
    target_id: str
    idempotency_key: str | None
    approval_id: UUID | None
    outcome: str | None
    detail: dict[str, Any]
    error: str
    resolution: str | None
    resolved_by: str
    created_at: datetime
    ended_at: datetime | None
    resolved_at: datetime | None = None

    def is_unresolved_indeterminate(self, now: datetime) -> bool:
        if self.resolution is not None:
            return False
        if self.outcome == "indeterminate":
            return True
        return self.outcome is None and self.created_at < now - timedelta(minutes=STALE_DISPATCH_MINUTES)


class RailsStore(Protocol):
    async def engaged_kill_switches(self) -> frozenset[str]: ...
    async def has_unresolved(self, user_id: str, target_type: str, target_id: str) -> bool: ...
    async def find_by_key(self, user_id: str, action: str, key: str) -> ExecutionRow | None: ...
    async def claim(self, claim_key: str) -> bool: ...
    async def release(self, claim_key: str) -> None: ...
    async def start(self, row: NewExecution) -> UUID: ...
    async def finish(self, execution_id: UUID, outcome: str, *, detail: dict[str, Any] | None = None, error: str = "") -> bool: ...
    async def record_denied(self, row: NewExecution, *, code: str, reason: str) -> None: ...
    async def open_required_actions(self, user_id: str, *, limit: int = 50) -> list[ExecutionRow]: ...
    async def get(self, user_id: str, execution_id: UUID) -> ExecutionRow | None: ...
    async def resolve(self, user_id: str, execution_id: UUID, *, resolution: str, resolved_by: str) -> ExecutionRow | None: ...
    async def expire_approval(self, user_id: str, approval_id: UUID) -> None: ...


_COLS = (
    "id, user_id, action, tier, principal, args_hash, target_type, target_id, "
    "idempotency_key, approval_id, outcome, detail, error, resolution, resolved_by, "
    "created_at, ended_at, resolved_at"
)
_UNRESOLVED = (
    "resolution is null and (outcome = 'indeterminate' or "
    f"(outcome is null and created_at < now() - interval '{STALE_DISPATCH_MINUTES} minutes'))"
)


def _row(r: Any) -> ExecutionRow:
    d = dict(r)
    if isinstance(d.get("detail"), str):
        d["detail"] = json.loads(d["detail"])
    d["detail"] = d.get("detail") or {}
    return ExecutionRow(**d)


class PostgresRailsStore:
    async def _pool(self):
        from ..db import get_pool

        return await get_pool()

    async def engaged_kill_switches(self) -> frozenset[str]:
        pool = await self._pool()
        rows = await pool.fetch(
            "select key from feature_flags where key = any($1::text[]) and enabled",
            list(KILL_SWITCH_FLAGS),
        )
        return frozenset(KILL_SWITCH_FLAGS[r["key"]] for r in rows)

    async def has_unresolved(self, user_id: str, target_type: str, target_id: str) -> bool:
        pool = await self._pool()
        val = await pool.fetchval(
            f"select exists(select 1 from rails_executions where user_id = $1 and target_type = $2 "
            f"and target_id = $3 and {_UNRESOLVED})",
            user_id, target_type, target_id,
        )
        return bool(val)

    async def find_by_key(self, user_id: str, action: str, key: str) -> ExecutionRow | None:
        pool = await self._pool()
        row = await pool.fetchrow(
            f"select {_COLS} from rails_executions where user_id = $1 and action = $2 "
            "and idempotency_key = $3 and coalesce(outcome, '') <> 'denied' "
            "order by created_at desc limit 1",
            user_id, action, key,
        )
        return _row(row) if row else None

    async def claim(self, claim_key: str) -> bool:
        from ..repos import idempotency as idempotency_repo

        return await idempotency_repo.claim(claim_key, ttl_seconds=CLAIM_TTL_SECONDS)

    async def release(self, claim_key: str) -> None:
        from ..repos import idempotency as idempotency_repo

        await idempotency_repo.release(claim_key)

    async def start(self, row: NewExecution) -> UUID:
        pool = await self._pool()
        return await pool.fetchval(
            """
            insert into rails_executions
                (user_id, action, tier, principal, actor_email, target_type, target_id,
                 args_hash, idempotency_key, approval_id, detail)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
            returning id
            """,
            row.user_id, row.action, row.tier, row.principal, row.actor_email,
            row.target_type, row.target_id, row.args_hash, row.idempotency_key,
            row.approval_id, json.dumps(row.detail, default=str),
        )

    async def finish(self, execution_id: UUID, outcome: str, *, detail: dict[str, Any] | None = None, error: str = "") -> bool:
        pool = await self._pool()
        result = await pool.execute(
            """
            update rails_executions
               set outcome = $2, ended_at = now(), error = $3,
                   detail = detail || $4::jsonb
             where id = $1 and outcome is null
            """,
            execution_id, outcome, error[:2000], json.dumps(detail or {}, default=str),
        )
        return result.endswith(" 1")

    async def record_denied(self, row: NewExecution, *, code: str, reason: str) -> None:
        pool = await self._pool()
        await pool.execute(
            """
            insert into rails_executions
                (user_id, action, tier, principal, actor_email, target_type, target_id,
                 args_hash, idempotency_key, approval_id, detail, outcome, error, ended_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'denied',$12, now())
            """,
            row.user_id, row.action, row.tier, row.principal, row.actor_email,
            row.target_type, row.target_id, row.args_hash, row.idempotency_key,
            row.approval_id, json.dumps({**row.detail, "code": code}, default=str), reason[:2000],
        )

    async def open_required_actions(self, user_id: str, *, limit: int = 50) -> list[ExecutionRow]:
        pool = await self._pool()
        rows = await pool.fetch(
            f"select {_COLS} from rails_executions where user_id = $1 and {_UNRESOLVED} "
            "order by created_at desc limit $2",
            user_id, limit,
        )
        return [_row(r) for r in rows]

    async def get(self, user_id: str, execution_id: UUID) -> ExecutionRow | None:
        pool = await self._pool()
        row = await pool.fetchrow(
            f"select {_COLS} from rails_executions where id = $1 and user_id = $2",
            execution_id, user_id,
        )
        return _row(row) if row else None

    async def resolve(self, user_id: str, execution_id: UUID, *, resolution: str, resolved_by: str) -> ExecutionRow | None:
        pool = await self._pool()
        row = await pool.fetchrow(
            f"""
            update rails_executions
               set resolution = $3, resolved_by = $4, resolved_at = now()
             where id = $1 and user_id = $2 and {_UNRESOLVED}
            returning {_COLS}
            """,
            execution_id, user_id, resolution, resolved_by,
        )
        return _row(row) if row else None

    async def expire_approval(self, user_id: str, approval_id: UUID) -> None:
        pool = await self._pool()
        await pool.execute(
            "update ad_approvals set status = 'expired' "
            "where id = $1 and user_id = $2 and status in ('pending', 'approved')",
            approval_id, user_id,
        )


class InMemoryRailsStore:
    """Same semantics as ``PostgresRailsStore``, in memory. Tests only."""

    def __init__(self) -> None:
        self.rows: dict[UUID, ExecutionRow] = {}
        self.claims: set[str] = set()
        self.kill_switches: set[str] = set()
        self.expired_approvals: list[UUID] = []
        self.fail_reads = False

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    async def engaged_kill_switches(self) -> frozenset[str]:
        if self.fail_reads:
            raise RuntimeError("rails store unavailable")
        return frozenset(self.kill_switches)

    async def has_unresolved(self, user_id: str, target_type: str, target_id: str) -> bool:
        if self.fail_reads:
            raise RuntimeError("rails store unavailable")
        now = self._now()
        return any(
            r.user_id == user_id and r.target_type == target_type and r.target_id == target_id
            and r.is_unresolved_indeterminate(now)
            for r in self.rows.values()
        )

    async def find_by_key(self, user_id: str, action: str, key: str) -> ExecutionRow | None:
        hits = [
            r for r in self.rows.values()
            if r.user_id == user_id and r.action == action and r.idempotency_key == key and r.outcome != "denied"
        ]
        return max(hits, key=lambda r: r.created_at) if hits else None

    async def claim(self, claim_key: str) -> bool:
        if claim_key in self.claims:
            return False
        self.claims.add(claim_key)
        return True

    async def release(self, claim_key: str) -> None:
        self.claims.discard(claim_key)

    def _make(self, row: NewExecution, **kw: Any) -> ExecutionRow:
        return ExecutionRow(
            id=uuid.uuid4(), user_id=row.user_id, action=row.action, tier=row.tier,
            principal=row.principal, args_hash=row.args_hash, target_type=row.target_type,
            target_id=row.target_id, idempotency_key=row.idempotency_key,
            approval_id=row.approval_id, outcome=kw.get("outcome"),
            detail=dict(row.detail), error=kw.get("error", ""), resolution=None,
            resolved_by="", created_at=self._now(), ended_at=kw.get("ended_at"),
        )

    async def start(self, row: NewExecution) -> UUID:
        made = self._make(row)
        self.rows[made.id] = made
        return made.id

    async def finish(self, execution_id: UUID, outcome: str, *, detail: dict[str, Any] | None = None, error: str = "") -> bool:
        r = self.rows.get(execution_id)
        if r is None or r.outcome is not None:
            return False
        r.outcome, r.error, r.ended_at = outcome, error[:2000], self._now()
        r.detail.update(detail or {})
        return True

    async def record_denied(self, row: NewExecution, *, code: str, reason: str) -> None:
        made = self._make(row, outcome="denied", error=reason, ended_at=self._now())
        made.detail["code"] = code
        self.rows[made.id] = made

    async def open_required_actions(self, user_id: str, *, limit: int = 50) -> list[ExecutionRow]:
        if self.fail_reads:
            raise RuntimeError("rails store unavailable")
        now = self._now()
        rows = [r for r in self.rows.values() if r.user_id == user_id and r.is_unresolved_indeterminate(now)]
        return sorted(rows, key=lambda r: r.created_at, reverse=True)[:limit]

    async def get(self, user_id: str, execution_id: UUID) -> ExecutionRow | None:
        r = self.rows.get(execution_id)
        return r if r is not None and r.user_id == user_id else None

    async def resolve(self, user_id: str, execution_id: UUID, *, resolution: str, resolved_by: str) -> ExecutionRow | None:
        r = await self.get(user_id, execution_id)
        if r is None or not r.is_unresolved_indeterminate(self._now()):
            return None
        r.resolution, r.resolved_by, r.resolved_at = resolution, resolved_by, self._now()
        return r

    async def expire_approval(self, user_id: str, approval_id: UUID) -> None:
        self.expired_approvals.append(approval_id)


_store: RailsStore = PostgresRailsStore()


def get_store() -> RailsStore:
    return _store


def set_store(store: RailsStore) -> RailsStore:
    """Install *store*; returns the previous one (tests restore it)."""
    global _store
    previous, _store = _store, store
    return previous
