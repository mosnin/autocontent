"""SpendContext threaded through provider calls so they can record costs.

The pipeline constructs one per Job and hands it to each provider call;
providers compute units + USD and append a row to spend_ledger. Pure
data class — no I/O, easy to construct in tests with a fake recorder.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from ..models import SpendEntry


class SpendRecorder(Protocol):
    async def __call__(self, entry: SpendEntry) -> None: ...


@dataclass
class SpendContext:
    user_id: str
    niche_id: UUID
    job_id: UUID | None
    record: SpendRecorder

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


async def _default_record(entry: SpendEntry) -> None:
    from ..repos import spend as spend_repo

    await spend_repo.record(entry)


def default_context(*, user_id: str, niche_id: UUID, job_id: UUID | None) -> SpendContext:
    return SpendContext(
        user_id=user_id, niche_id=niche_id, job_id=job_id, record=_default_record
    )
