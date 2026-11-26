"""Persistence for story videos (db/migrations/0036_story_videos.sql).

``StoryStore`` is the seam: ``PostgresStoryStore`` in production,
``InMemoryStoryStore`` in tests. Every write is a targeted update of named
columns, so a background stage and a person's edit never clobber each other's
fields.
"""
from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Protocol
from uuid import UUID, uuid4

from .models import Charge, StoryPlan, StoryVideo

UPDATABLE = frozenset({
    "title", "status", "stage", "revision", "plan", "estimate_micros", "approval_status",
    "approval_args_hash", "approved_by", "approved_at", "video_path", "error", "niche_id", "style",
    "requirement",
})


class StoryStore(Protocol):
    async def create(self, story: StoryVideo) -> StoryVideo: ...
    async def get(self, story_id: UUID, *, user_id: str) -> StoryVideo | None: ...
    async def list(self, user_id: str, *, limit: int = 50) -> list[StoryVideo]: ...
    async def update(self, story_id: UUID, *, user_id: str, **fields: Any) -> StoryVideo | None: ...
    async def claim_status(self, story_id: UUID, *, user_id: str, allowed: set[str], to: str, stage: str = "") -> StoryVideo | None: ...
    async def checkpoints(self, story_id: UUID) -> dict[str, dict[str, Any]]: ...
    async def put_checkpoint(self, story_id: UUID, key: str, artifact: dict[str, Any]) -> None: ...
    async def record_charge(self, charge: Charge) -> bool: ...
    async def charges(self, story_id: UUID) -> list[Charge]: ...


def _check(fields: dict[str, Any]) -> None:
    bad = set(fields) - UPDATABLE
    if bad:
        raise ValueError(f"not updatable: {sorted(bad)}")


class InMemoryStoryStore:
    def __init__(self) -> None:
        self.rows: dict[UUID, StoryVideo] = {}
        self.cps: dict[UUID, dict[str, dict[str, Any]]] = {}
        self.charge_rows: list[Charge] = []
        self.charge_keys: set[tuple[str, str]] = set()

    async def create(self, story: StoryVideo) -> StoryVideo:
        now = datetime.now(timezone.utc)
        row = story.model_copy(update={"id": story.id or uuid4(), "created_at": now, "updated_at": now})
        self.rows[row.id] = row
        return deepcopy(row)

    async def get(self, story_id: UUID, *, user_id: str) -> StoryVideo | None:
        row = self.rows.get(story_id)
        return deepcopy(row) if row is not None and row.user_id == user_id else None

    async def list(self, user_id: str, *, limit: int = 50) -> list[StoryVideo]:
        rows = [r for r in self.rows.values() if r.user_id == user_id]
        rows.sort(key=lambda r: r.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return [deepcopy(r) for r in rows[:limit]]

    async def update(self, story_id: UUID, *, user_id: str, **fields: Any) -> StoryVideo | None:
        _check(fields)
        row = self.rows.get(story_id)
        if row is None or row.user_id != user_id:
            return None
        if isinstance(fields.get("plan"), dict):
            fields["plan"] = StoryPlan.model_validate(fields["plan"])
        updated = row.model_copy(update={**deepcopy(fields), "updated_at": datetime.now(timezone.utc)})
        self.rows[story_id] = updated
        return deepcopy(updated)

    async def claim_status(self, story_id: UUID, *, user_id: str, allowed: set[str], to: str, stage: str = "") -> StoryVideo | None:
        row = self.rows.get(story_id)
        if row is None or row.user_id != user_id or row.status.value not in allowed:
            return None
        return await self.update(story_id, user_id=user_id, status=to, stage=stage, error=None)

    async def checkpoints(self, story_id: UUID) -> dict[str, dict[str, Any]]:
        return deepcopy(self.cps.get(story_id, {}))

    async def put_checkpoint(self, story_id: UUID, key: str, artifact: dict[str, Any]) -> None:
        self.cps.setdefault(story_id, {})[key] = deepcopy(artifact)

    async def record_charge(self, charge: Charge) -> bool:
        k = (charge.user_id, charge.idempotency_key)
        if k in self.charge_keys:
            return False
        self.charge_keys.add(k)
        self.charge_rows.append(charge)
        row = self.rows.get(charge.story_id)
        if row is not None:
            self.rows[charge.story_id] = row.model_copy(update={"spent_micros": row.spent_micros + charge.cost_micros})
        return True

    async def charges(self, story_id: UUID) -> list[Charge]:
        return [c for c in self.charge_rows if c.story_id == story_id]


_COLS = (
    "id, user_id, niche_id, created_by, title, mode, source, requirement, style, aspect, status, stage, "
    "revision, plan, estimate_micros, spent_micros, approval_status, approval_args_hash, approved_by, "
    "approved_at, video_path, error, created_at, updated_at"
)


def _row(r: Any) -> StoryVideo:
    d = dict(r)
    plan = d.get("plan")
    d["plan"] = StoryPlan.model_validate(json.loads(plan) if isinstance(plan, str) else (plan or {}))
    return StoryVideo.model_validate(d)


class PostgresStoryStore:
    async def _pool(self):
        from ..db import get_pool

        return await get_pool()

    async def create(self, story: StoryVideo) -> StoryVideo:
        pool = await self._pool()
        r = await pool.fetchrow(
            f"""insert into story_videos (id, user_id, niche_id, created_by, title, mode, source, requirement,
                    style, aspect, status, plan)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
                returning {_COLS}""",
            story.id, story.user_id, story.niche_id, story.created_by, story.title, story.mode, story.source,
            story.requirement, story.style, story.aspect, story.status.value, story.plan.model_dump_json(),
        )
        return _row(r)

    async def get(self, story_id: UUID, *, user_id: str) -> StoryVideo | None:
        pool = await self._pool()
        r = await pool.fetchrow(f"select {_COLS} from story_videos where id = $1 and user_id = $2", story_id, user_id)
        return _row(r) if r else None

    async def list(self, user_id: str, *, limit: int = 50) -> list[StoryVideo]:
        pool = await self._pool()
        rows = await pool.fetch(
            f"select {_COLS} from story_videos where user_id = $1 order by created_at desc limit $2", user_id, limit
        )
        return [_row(r) for r in rows]

    async def update(self, story_id: UUID, *, user_id: str, **fields: Any) -> StoryVideo | None:
        _check(fields)
        sets, args = [], [story_id, user_id]
        for i, (k, v) in enumerate(fields.items(), start=3):
            if k == "plan":
                v = v.model_dump_json() if isinstance(v, StoryPlan) else json.dumps(v)
                sets.append(f"plan = ${i}::jsonb")
            else:
                if hasattr(v, "value"):
                    v = v.value
                sets.append(f"{k} = ${i}")
            args.append(v)
        sets.append("updated_at = now()")
        pool = await self._pool()
        r = await pool.fetchrow(
            f"update story_videos set {', '.join(sets)} where id = $1 and user_id = $2 returning {_COLS}", *args
        )
        return _row(r) if r else None

    async def claim_status(self, story_id: UUID, *, user_id: str, allowed: set[str], to: str, stage: str = "") -> StoryVideo | None:
        """Atomic status transition: exactly one caller wins a double click."""
        pool = await self._pool()
        r = await pool.fetchrow(
            f"""update story_videos set status = $3, stage = $4, error = null, updated_at = now()
                 where id = $1 and user_id = $2 and status = any($5::text[]) returning {_COLS}""",
            story_id, user_id, to, stage, sorted(allowed),
        )
        return _row(r) if r else None

    async def checkpoints(self, story_id: UUID) -> dict[str, dict[str, Any]]:
        pool = await self._pool()
        rows = await pool.fetch("select key, artifact from story_checkpoints where story_id = $1", story_id)
        return {r["key"]: (json.loads(r["artifact"]) if isinstance(r["artifact"], str) else dict(r["artifact"])) for r in rows}

    async def put_checkpoint(self, story_id: UUID, key: str, artifact: dict[str, Any]) -> None:
        pool = await self._pool()
        await pool.execute(
            """insert into story_checkpoints (story_id, key, artifact) values ($1, $2, $3::jsonb)
               on conflict (story_id, key) do update set artifact = excluded.artifact, created_at = now()""",
            story_id, key, json.dumps(artifact, default=str),
        )

    async def record_charge(self, charge: Charge) -> bool:
        """Insert the charge and add it to the story's total in one
        transaction. False when the key was already charged."""
        pool = await self._pool()
        async with pool.acquire() as conn, conn.transaction():
            inserted = await conn.fetchval(
                """insert into story_charges (user_id, story_id, idempotency_key, stage, provider, sku, units, cost_micros)
                   values ($1, $2, $3, $4, $5, $6, $7, $8)
                   on conflict (user_id, idempotency_key) do nothing returning id""",
                charge.user_id, charge.story_id, charge.idempotency_key, charge.stage, charge.provider, charge.sku,
                charge.units, charge.cost_micros,
            )
            if inserted is None:
                return False
            await conn.execute(
                "update story_videos set spent_micros = spent_micros + $2 where id = $1", charge.story_id, charge.cost_micros
            )
            return True

    async def charges(self, story_id: UUID) -> list[Charge]:
        pool = await self._pool()
        rows = await pool.fetch(
            "select story_id, user_id, idempotency_key, stage, provider, sku, units, cost_micros from story_charges "
            "where story_id = $1 order by id", story_id,
        )
        return [Charge.model_validate(dict(r)) for r in rows]


_store: StoryStore = PostgresStoryStore()


def get_store() -> StoryStore:
    return _store


def set_store(store: StoryStore) -> StoryStore:
    global _store
    previous, _store = _store, store
    return previous
