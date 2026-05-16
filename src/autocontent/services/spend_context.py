"""SpendContext threaded through provider calls so they can record costs.

The pipeline constructs one per Job and hands it to each provider call;
providers compute units + USD and append a row to spend_ledger.

Cap enforcement (race-safe): every call to `SpendContext.log` records
the entry, then re-reads today's spend from the DB and raises
`SpendCapExceeded` if the niche has now exceeded `cap_usd`. Because the
DB query is the source of truth, this works even when multiple jobs for
the same niche are spending concurrently — and even when N parallel
fan-out tasks within one job race past the pre-stage `_ensure_cap`
check. An in-process `asyncio.Event` is also flipped so the rest of the
job can short-circuit cheaply.

Cap is optional: a `SpendContext` with `cap_usd=None` skips the in-`log`
check entirely (no extra DB calls) and behaves like the old code path.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from ..models import SpendEntry


class SpendRecorder(Protocol):
    async def __call__(self, entry: SpendEntry) -> None: ...


class TodaySpendReader(Protocol):
    async def __call__(self, *, user_id: str, niche_id: UUID) -> Decimal: ...


async def _default_today_spend(*, user_id: str, niche_id: UUID) -> Decimal:
    from ..repos import spend as spend_repo

    return await spend_repo.today_spend_usd(user_id=user_id, niche_id=niche_id)


@dataclass
class SpendContext:
    user_id: str
    niche_id: UUID
    job_id: UUID | None
    record: SpendRecorder
    cap_usd: Decimal | None = None
    today_spend: TodaySpendReader = field(default=_default_today_spend)
    abort_event: asyncio.Event = field(default_factory=asyncio.Event)

    async def log(
        self,
        *,
        provider: str,
        sku: str,
        units: Decimal,
        cost_usd: Decimal,
    ) -> None:
        await self.record(
            SpendEntry(
                user_id=self.user_id,
                niche_id=self.niche_id,
                job_id=self.job_id,
                provider=provider,
                sku=sku,
                units=units,
                cost_usd=cost_usd,
            )
        )

        # Late-imports so a `from .spend_context import SpendContext`
        # doesn't pull `db.get_pool` into modules that never spend.
        from ..logging import get_logger
        from ..repos.spend import SpendCapExceeded

        get_logger(__name__).info(
            "spend",
            extra={"provider": provider, "sku": sku, "cost_usd": str(cost_usd)},
        )

        if self.cap_usd is None:
            return

        spent = await self.today_spend(user_id=self.user_id, niche_id=self.niche_id)
        if spent >= self.cap_usd:
            self.abort_event.set()
            raise SpendCapExceeded(
                f"niche {self.niche_id} hit daily cap during job: "
                f"${spent} >= ${self.cap_usd}"
            )


async def _default_record(entry: SpendEntry) -> None:
    from ..repos import spend as spend_repo

    await spend_repo.record(entry)


def default_context(
    *,
    user_id: str,
    niche_id: UUID,
    job_id: UUID | None,
    cap_usd: Decimal | None = None,
) -> SpendContext:
    return SpendContext(
        user_id=user_id,
        niche_id=niche_id,
        job_id=job_id,
        record=_default_record,
        cap_usd=cap_usd,
    )
