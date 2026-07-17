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

Both caps are optional:
- ``cap_usd=None`` skips per-niche post-log checks.
- ``global_cap_usd=None`` skips global post-log checks.
Either can be active independently. ``ensure_can_spend`` and ``log``
check whichever caps are configured.

Prepaid credit (hosted product) gets the same treatment: ``log`` debits
the ledger and then re-reads the returned balance, tripping ``abort_event``
if it has gone non-positive. Without that post-debit check, N fan-out tasks
in one stage could all clear the pre-flight balance snapshot and each debit,
taking the balance negative and spending past what the user paid for.
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
    async def __call__(self, *, user_id: str, niche_id: UUID | None) -> Decimal: ...


class TotalSpendReader(Protocol):
    async def __call__(self, *, user_id: str) -> Decimal: ...


async def _default_today_spend(*, user_id: str, niche_id: UUID | None) -> Decimal:
    from ..repos import spend as spend_repo

    return await spend_repo.today_spend_usd(user_id=user_id, niche_id=niche_id)


async def _default_today_total_spend(*, user_id: str) -> Decimal:
    from ..repos import spend as spend_repo

    return await spend_repo.today_spend_total_usd(user_id=user_id)


@dataclass
class SpendContext:
    user_id: str
    # None for Content Studio calls with no niche in scope — cap_usd must
    # also be None in that case (there is no niche to check a cap against).
    niche_id: UUID | None
    job_id: UUID | None
    record: SpendRecorder
    article_id: UUID | None = None
    cap_usd: Decimal | None = None
    today_spend: TodaySpendReader = field(default=_default_today_spend)
    global_cap_usd: Decimal | None = None
    today_total_spend: TotalSpendReader | None = None
    abort_event: asyncio.Event = field(default_factory=asyncio.Event)
    # Why the job was aborted, so the cheap pre-flight short-circuit can
    # report the real reason (niche/global cap vs. exhausted credit) rather
    # than always blaming the niche cap.
    abort_scope: str = "niche"

    def _trip(self, scope: str) -> None:
        self.abort_scope = scope
        self.abort_event.set()

    async def ensure_can_spend(self, estimated_usd: Decimal) -> None:
        """Refuse a provider call if it would exceed today's cap.

        No-op when cap_usd is None. Checks abort_event first (cheap
        in-process signal set by a sibling task that already tripped the
        cap), then reads today_spend from the DB once and raises
        SpendCapExceeded if (today + estimated) > cap.

        If global_cap_usd is also set, performs the same check against
        the user's total cross-niche spend for the day.
        """
        from ..repos.spend import SpendCapExceeded

        if self.abort_event.is_set():
            raise SpendCapExceeded(
                f"niche {self.niche_id} spend aborted: {self.abort_scope} "
                "limit already reached",
                scope=self.abort_scope,
            )

        if self.cap_usd is not None:
            spent = await self.today_spend(user_id=self.user_id, niche_id=self.niche_id)
            if spent + estimated_usd > self.cap_usd:
                self._trip("niche")
                raise SpendCapExceeded(
                    f"niche {self.niche_id} pre-flight cap check: "
                    f"${spent} + ${estimated_usd} > ${self.cap_usd}",
                    scope="niche",
                )

        if self.global_cap_usd is not None and self.today_total_spend is not None:
            total_spent = await self.today_total_spend(user_id=self.user_id)
            if total_spent + estimated_usd > self.global_cap_usd:
                self._trip("global")
                raise SpendCapExceeded(
                    f"user {self.user_id} pre-flight global cap check: "
                    f"${total_spent} + ${estimated_usd} > ${self.global_cap_usd}",
                    scope="global",
                )

        # Hosted product: prepaid credit is the final gate. The estimated
        # charge includes the billing margin so a call is refused before
        # it would take the balance negative.
        from ..config import settings

        if settings.billing_enabled:
            from decimal import Decimal as _D

            from ..repos import billing as billing_repo

            bal = await billing_repo.balance(self.user_id)
            charge = estimated_usd * _D(str(settings.billing_margin))
            if bal < charge:
                self._trip("credits")
                raise SpendCapExceeded(
                    f"user {self.user_id} has ${bal} credit; "
                    f"call would charge ${charge}. Top up to continue.",
                    scope="credits",
                )

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
                article_id=self.article_id,
                provider=provider,
                sku=sku,
                units=units,
                cost_usd=cost_usd,
            )
        )

        # Hosted product: mirror the spend into the credit ledger at
        # cost * margin. Runs before the cap checks so the charge lands
        # even when this call is the one that trips a cap.
        from ..config import settings as _settings

        new_balance: Decimal | None = None
        if _settings.billing_enabled:
            from decimal import Decimal as _D

            from ..repos import billing as billing_repo

            new_balance = await billing_repo.debit(
                user_id=self.user_id,
                amount_usd=cost_usd * _D(str(_settings.billing_margin)),
                job_id=self.job_id,
                description=f"{provider}/{sku}",
            )

        # Late-imports so a `from .spend_context import SpendContext`
        # doesn't pull `db.get_pool` into modules that never spend.
        from ..logging import get_logger
        from ..repos.spend import SpendCapExceeded

        get_logger(__name__).info(
            "spend",
            extra={"provider": provider, "sku": sku, "cost_usd": str(cost_usd)},
        )

        # Prepaid credit is post-checked here, symmetric with the niche/global
        # cap re-reads below. `ensure_can_spend` gates each call pre-flight, but
        # N fan-out tasks in one stage all read the same balance snapshot before
        # any debit lands, so they can collectively cross zero. The ledger is
        # the source of truth: once the balance is non-positive we flip
        # abort_event so sibling tasks and every later stage short-circuit
        # cheaply instead of continuing to spend the operator's money.
        if new_balance is not None and new_balance <= 0:
            self._trip("credits")
            raise SpendCapExceeded(
                f"user {self.user_id} exhausted prepaid credit during job: "
                f"balance ${new_balance} after {provider}/{sku}. Top up to continue.",
                scope="credits",
            )

        if self.cap_usd is not None:
            spent = await self.today_spend(user_id=self.user_id, niche_id=self.niche_id)
            if spent >= self.cap_usd:
                self._trip("niche")
                raise SpendCapExceeded(
                    f"niche {self.niche_id} hit daily cap during job: "
                    f"${spent} >= ${self.cap_usd}",
                    scope="niche",
                )

        if self.global_cap_usd is not None and self.today_total_spend is not None:
            total_spent = await self.today_total_spend(user_id=self.user_id)
            if total_spent >= self.global_cap_usd:
                self._trip("global")
                raise SpendCapExceeded(
                    f"user {self.user_id} hit global daily cap during job: "
                    f"${total_spent} >= ${self.global_cap_usd}",
                    scope="global",
                )


async def _default_record(entry: SpendEntry) -> None:
    from ..repos import spend as spend_repo

    await spend_repo.record(entry)


async def default_context(
    *,
    user_id: str,
    niche_id: UUID | None,
    job_id: UUID | None,
    article_id: UUID | None = None,
    cap_usd: Decimal | None = None,
) -> SpendContext:
    """Build the canonical SpendContext for a pipeline job.

    Fetches the user record to wire the global daily cap and plugs in the
    default DB-backed readers. The function is async so we can do one
    users-repo lookup without coupling the pipeline to a synchronous
    construction pattern or adding a separate init step.
    """
    from ..repos import users as users_repo

    user = await users_repo.get(user_id)
    global_cap_usd = user.global_daily_cap_usd if user is not None else None

    return SpendContext(
        user_id=user_id,
        niche_id=niche_id,
        job_id=job_id,
        article_id=article_id,
        record=_default_record,
        cap_usd=cap_usd,
        global_cap_usd=global_cap_usd,
        today_total_spend=_default_today_total_spend if global_cap_usd is not None else None,
    )
