"""Metering for story videos: integer micro-dollars, one charge per key.

Every provider call in a story runs inside ``meter.unit(key, stage)``, where
``key`` is the unit's checkpoint key (models.key_*). Providers keep calling
``spend.log(...)`` as they do everywhere else; ``MeteredSpend`` routes that
call through the meter, which

1. converts the cost to integer micro-dollars;
2. inserts a ``story_charges`` row under ``story:{id}:{unit key}#{n}``
   (``n`` counts charges inside the unit, so a unit with two paid calls has
   two keys) and adds it to the story's total, in one transaction;
3. only when that row is new, writes the spend_ledger row through the normal
   ``SpendContext.log`` (credit debit, niche / global cap re-checks).

So a replayed unit (a worker retried after the provider charged but before
the checkpoint landed) never charges the workspace twice. We absorb that
provider cost; the customer is never billed for the same unit of work twice.

Before every paid call ``ensure_can_spend`` also checks the story's own
ceiling (``story_settings.max_usd``) and then the usual caps.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any
from uuid import UUID

from ..repos.spend import SpendCapExceeded
from ..services.spend_context import SpendContext
from .models import Charge, micros_to_usd, usd_to_micros
from .store import StoryStore


class StoryCapExceeded(SpendCapExceeded):
    """The story's own ceiling would be crossed. Nothing was sent."""

    def __init__(self, message: str) -> None:
        super().__init__(message, scope="story")


@dataclass
class _Unit:
    key: str
    stage: str
    n: int = 0


_UNIT: ContextVar[_Unit | None] = ContextVar("story_meter_unit", default=None)


class StoryMeter:
    def __init__(self, *, store: StoryStore, story_id: UUID, user_id: str, base: SpendContext,
                 spent_micros: int = 0, ceiling_micros: int | None = None) -> None:
        self.store = store
        self.story_id = story_id
        self.user_id = user_id
        self.spent_micros = spent_micros
        self.ceiling_micros = ceiling_micros
        self.spend = MeteredSpend(
            user_id=base.user_id, niche_id=base.niche_id, job_id=None, record=base.record,
            cap_usd=base.cap_usd, today_spend=base.today_spend, global_cap_usd=base.global_cap_usd,
            today_total_spend=base.today_total_spend, abort_event=base.abort_event, meter=self,
        )

    @asynccontextmanager
    async def unit(self, key: str, stage: str) -> AsyncIterator[None]:
        token = _UNIT.set(_Unit(key=key, stage=stage))
        try:
            yield
        finally:
            _UNIT.reset(token)

    def idempotency_key(self, unit: _Unit) -> str:
        return f"story:{self.story_id}:{unit.key}#{unit.n}"

    async def ensure(self, estimated_usd: Decimal) -> None:
        if self.ceiling_micros is None:
            return
        est = usd_to_micros(max(Decimal(0), Decimal(str(estimated_usd))))
        if self.spent_micros + est > self.ceiling_micros:
            raise StoryCapExceeded(
                f"story {self.story_id} would pass its ${micros_to_usd(self.ceiling_micros)} ceiling "
                f"(spent ${micros_to_usd(self.spent_micros)}, next call about ${micros_to_usd(est)})"
            )

    async def record(self, *, provider: str, sku: str, units: Decimal, cost_usd: Decimal) -> bool:
        unit = _UNIT.get()
        if unit is None:
            raise RuntimeError("story spend logged outside a metered unit")
        key = self.idempotency_key(unit)
        unit.n += 1
        micros = usd_to_micros(cost_usd)
        new = await self.store.record_charge(Charge(
            story_id=self.story_id, user_id=self.user_id, idempotency_key=key, stage=unit.stage,
            provider=provider, sku=sku, units=Decimal(str(units)), cost_micros=micros,
        ))
        if new:
            self.spent_micros += micros
        return new


@dataclass
class MeteredSpend(SpendContext):
    meter: Any = field(default=None)

    async def ensure_can_spend(self, estimated_usd: Decimal) -> None:
        if self.meter is not None:
            await self.meter.ensure(estimated_usd)
        await super().ensure_can_spend(estimated_usd)

    async def log(self, *, provider: str, sku: str, units: Decimal, cost_usd: Decimal) -> None:
        if self.meter is not None:
            new = await self.meter.record(provider=provider, sku=sku, units=units, cost_usd=cost_usd)
            if not new:
                return
        await super().log(provider=provider, sku=sku, units=units, cost_usd=cost_usd)
