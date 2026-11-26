"""Integer micro-dollar metering with an idempotency key per paid call.

Every paid provider call in a short video goes through ``Meter.charge``:

1. The key (``sv:{item}:{attempt}:{stage}``) is claimed in
   ``short_video_charges`` BEFORE the call. A key already ``done`` means the
   call happened: the provider is not called again and the caller reuses the
   artifact on disk. A key left ``pending`` (a crash mid-call) is an unknown
   outcome: we raise ``IndeterminateCharge`` and a person retries, which uses
   a new attempt number. Nothing is re-bought silently.
2. The batch cap is checked against what the batch has already spent plus the
   call's estimate.
3. The provider function receives a ``SpendContext`` whose recorder forwards
   to the real one (``spend_ledger``, credits, playbook and global caps) and
   also captures the entries, so the exact cost lands on the charge row in
   micro-dollars, rounded up.
"""
from __future__ import annotations

import dataclasses
from collections.abc import Awaitable, Callable
from decimal import ROUND_CEILING, Decimal
from typing import Literal, Protocol, TypeVar
from uuid import UUID

from ..models import SpendEntry
from ..services.spend_context import SpendContext

T = TypeVar("T")

MICROS_PER_USD = 1_000_000

ClaimResult = Literal["new", "done", "pending"]


def usd_to_micros(usd: Decimal | float | int | str) -> int:
    """USD → integer micro-dollars, rounded up (never under-meter)."""
    value = Decimal(str(usd)) * MICROS_PER_USD
    return int(value.to_integral_value(rounding=ROUND_CEILING))


def micros_to_usd(micros: int) -> Decimal:
    return (Decimal(int(micros)) / MICROS_PER_USD).quantize(Decimal("0.000001"))


def charge_key(item_id: UUID | str, attempt: int, stage: str) -> str:
    return f"sv:{item_id}:{attempt}:{stage}"


class BatchCapExceeded(RuntimeError):
    def __init__(self, spent: int, estimate: int, cap: int) -> None:
        self.spent, self.estimate, self.cap = spent, estimate, cap
        super().__init__(
            f"batch spend cap: ${micros_to_usd(spent)} spent + ${micros_to_usd(estimate)} "
            f"estimated > ${micros_to_usd(cap)} cap"
        )


class IndeterminateCharge(RuntimeError):
    """A paid call with this key started and never finished. It may have been
    billed; retrying the item (a new attempt) is a person's decision."""


class ChargeStore(Protocol):
    async def claim(
        self, key: str, *, user_id: str, batch_id: UUID, item_id: UUID,
        stage: str, provider: str, sku: str,
    ) -> ClaimResult: ...

    async def finish(self, key: str, *, status: Literal["done", "failed"], cost_micros: int) -> None: ...

    async def batch_spent_micros(self, batch_id: UUID) -> int: ...


class MemoryChargeStore:
    """In-process store for tests and dry runs."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    async def claim(self, key, *, user_id, batch_id, item_id, stage, provider, sku) -> ClaimResult:
        row = self.rows.get(key)
        if row is None:
            self.rows[key] = {
                "user_id": user_id, "batch_id": batch_id, "item_id": item_id, "stage": stage,
                "provider": provider, "sku": sku, "status": "pending", "cost_micros": 0,
            }
            return "new"
        if row["status"] == "done":
            return "done"
        if row["status"] == "failed":
            row["status"] = "pending"
            return "new"
        return "pending"

    async def finish(self, key, *, status, cost_micros) -> None:
        row = self.rows[key]
        row["status"] = status
        row["cost_micros"] = row["cost_micros"] + int(cost_micros)

    async def batch_spent_micros(self, batch_id) -> int:
        return sum(r["cost_micros"] for r in self.rows.values() if r["batch_id"] == batch_id)


SKIPPED = object()


@dataclasses.dataclass
class Meter:
    spend: SpendContext
    store: ChargeStore
    batch_id: UUID
    cap_micros: int

    async def charge(
        self,
        key: str,
        *,
        item_id: UUID,
        stage: str,
        provider: str,
        sku: str,
        estimate_micros: int,
        call: Callable[[SpendContext], Awaitable[T]],
    ) -> T | object:
        """Run one paid call exactly once per key. Returns the call's result,
        or ``SKIPPED`` when the key was already done."""
        claim = await self.store.claim(
            key, user_id=self.spend.user_id, batch_id=self.batch_id, item_id=item_id,
            stage=stage, provider=provider, sku=sku,
        )
        if claim == "done":
            return SKIPPED
        if claim == "pending":
            raise IndeterminateCharge(
                f"the {stage} step started earlier and its outcome is unknown; retry the variant to run it again"
            )
        spent = await self.store.batch_spent_micros(self.batch_id)
        if spent + estimate_micros > self.cap_micros:
            await self.store.finish(key, status="failed", cost_micros=0)
            raise BatchCapExceeded(spent, estimate_micros, self.cap_micros)

        captured: list[SpendEntry] = []
        forward = self.spend.record

        async def _record(entry: SpendEntry) -> None:
            captured.append(entry)
            await forward(entry)

        ctx = dataclasses.replace(self.spend, record=_record)
        try:
            result = await call(ctx)
        except BaseException:
            await self.store.finish(key, status="failed", cost_micros=_sum_micros(captured))
            raise
        await self.store.finish(key, status="done", cost_micros=_sum_micros(captured))
        return result


def _sum_micros(entries: list[SpendEntry]) -> int:
    return sum(usd_to_micros(e.cost_usd) for e in entries)
