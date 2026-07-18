"""Data layer for ads experiments: creative A/B tests and governed budget
ramps. Every experiment row is user_id-scoped; arms are scoped transitively
through their parent experiment (checked by callers via get_experiment).

This module only persists bookkeeping (experiment/arm state, config,
result). It never moves money and never calls Composio — actual
spend-affecting mutations flow through services/ad_actions_exec.py, driven
by services/ad_experiments.py which owns this repo.
"""
from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from ..db import get_pool

KINDS = frozenset({"creative_ab", "budget_ramp"})
STATUSES = frozenset({"draft", "running", "completed", "cancelled"})


class AdExperiment(BaseModel):
    id: UUID
    user_id: str
    campaign_id: UUID
    kind: str
    status: str = "draft"
    config: dict = Field(default_factory=dict)
    result: dict = Field(default_factory=dict)
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None


class AdExperimentArm(BaseModel):
    id: UUID
    experiment_id: UUID
    creative_id: UUID | None = None
    label: str = ""
    metrics: dict = Field(default_factory=dict)
    is_winner: bool = False
    created_at: datetime


_EXP_COLS = (
    "id, user_id, campaign_id, kind, status, config, result, created_at, "
    "started_at, completed_at"
)
_ARM_COLS = "id, experiment_id, creative_id, label, metrics, is_winner, created_at"


def _exp_row(r) -> AdExperiment:
    d = dict(r)
    for k in ("config", "result"):
        v = d.get(k)
        if isinstance(v, str):
            d[k] = json.loads(v)
    return AdExperiment(**d)


def _arm_row(r) -> AdExperimentArm:
    d = dict(r)
    v = d.get("metrics")
    if isinstance(v, str):
        d["metrics"] = json.loads(v)
    return AdExperimentArm(**d)


# --------------------------------------------------------------------------- experiments

async def create_experiment(
    *, user_id: str, campaign_id: UUID, kind: str, config: dict,
) -> AdExperiment:
    if kind not in KINDS:
        raise ValueError(f"unknown experiment kind {kind!r}")
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into ad_experiments (user_id, campaign_id, kind, config)
        values ($1, $2, $3, $4)
        returning {_EXP_COLS}
        """,
        user_id, campaign_id, kind, json.dumps(config),
    )
    return _exp_row(row)


async def get_experiment(experiment_id: UUID, *, user_id: str) -> AdExperiment | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_EXP_COLS} from ad_experiments where id = $1 and user_id = $2",
        experiment_id, user_id,
    )
    return _exp_row(row) if row else None


async def list_experiments(
    user_id: str, *, campaign_id: UUID | None = None, limit: int = 100
) -> list[AdExperiment]:
    pool = await get_pool()
    if campaign_id is not None:
        rows = await pool.fetch(
            f"select {_EXP_COLS} from ad_experiments "
            "where user_id = $1 and campaign_id = $2 order by created_at desc limit $3",
            user_id, campaign_id, limit,
        )
    else:
        rows = await pool.fetch(
            f"select {_EXP_COLS} from ad_experiments where user_id = $1 "
            "order by created_at desc limit $2",
            user_id, limit,
        )
    return [_exp_row(r) for r in rows]


async def update_experiment(
    experiment_id: UUID,
    *,
    user_id: str,
    status: str = ...,  # type: ignore[assignment]
    config: dict = ...,  # type: ignore[assignment]
    result: dict = ...,  # type: ignore[assignment]
    started_at: datetime | None = ...,  # type: ignore[assignment]
    completed_at: datetime | None = ...,  # type: ignore[assignment]
) -> AdExperiment | None:
    """Partial update; omitted kwargs are left unchanged (sentinel)."""
    updates: dict[str, object] = {}
    if status is not ...:
        if status not in STATUSES:
            raise ValueError(f"unknown status {status!r}")
        updates["status"] = status
    if config is not ...:
        updates["config"] = json.dumps(config)
    if result is not ...:
        updates["result"] = json.dumps(result)
    if started_at is not ...:
        updates["started_at"] = started_at
    if completed_at is not ...:
        updates["completed_at"] = completed_at
    if not updates:
        return await get_experiment(experiment_id, user_id=user_id)
    set_clause = ", ".join(f"{c} = ${i + 3}" for i, c in enumerate(updates))
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""update ad_experiments set {set_clause}
             where id = $1 and user_id = $2 returning {_EXP_COLS}""",
        experiment_id, user_id, *updates.values(),
    )
    return _exp_row(row) if row else None


# --------------------------------------------------------------------------- arms

async def create_arm(
    *, experiment_id: UUID, creative_id: UUID | None, label: str = "",
) -> AdExperimentArm:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""insert into ad_experiment_arms (experiment_id, creative_id, label)
             values ($1, $2, $3) returning {_ARM_COLS}""",
        experiment_id, creative_id, label,
    )
    return _arm_row(row)


async def list_arms(experiment_id: UUID) -> list[AdExperimentArm]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_ARM_COLS} from ad_experiment_arms where experiment_id = $1 "
        "order by created_at asc",
        experiment_id,
    )
    return [_arm_row(r) for r in rows]


async def update_arm(
    arm_id: UUID,
    *,
    metrics: dict = ...,  # type: ignore[assignment]
    is_winner: bool = ...,  # type: ignore[assignment]
) -> AdExperimentArm | None:
    updates: dict[str, object] = {}
    if metrics is not ...:
        updates["metrics"] = json.dumps(metrics)
    if is_winner is not ...:
        updates["is_winner"] = is_winner
    pool = await get_pool()
    if not updates:
        row = await pool.fetchrow(
            f"select {_ARM_COLS} from ad_experiment_arms where id = $1", arm_id
        )
        return _arm_row(row) if row else None
    set_clause = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(updates))
    row = await pool.fetchrow(
        f"update ad_experiment_arms set {set_clause} where id = $1 returning {_ARM_COLS}",
        arm_id, *updates.values(),
    )
    return _arm_row(row) if row else None
