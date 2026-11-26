"""Bulk article generation: a keyword list becomes a queue of article runs.

``create`` checks the list and stores one item per keyword. ``tick_batch``
moves a batch forward and is safe to call any number of times (the create
route calls it once; the ``seo_tick`` cron calls it every few minutes):

1. Running items whose article finished take its status.
2. At most ``article_bulk_concurrency`` items of one batch run at once.
3. Before an item starts, the spend caps are checked as they are now
   (playbook daily cap, account global cap, prepaid credit) for one article's
   estimated cost. A refusal does not fail anything: the remaining items wait
   (``held_reason='spend_cap'``, batch ``paused_cap``) and start on a later
   tick once the caps allow, typically the next day.
4. An item is claimed atomically (queued -> running) and its spawn is
   guarded by an idempotency key, so two ticks never start it twice.

Each article run then meters every model call itself, through the same
SpendContext, so the caps also stop a run that turns out dearer than the
estimate.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from uuid import UUID

from ..config import settings
from ..logging import get_logger
from ..repos import article_batches as batches_repo
from ..repos import articles as articles_repo
from . import seo_meta

log = get_logger(__name__)

# What one article run usually costs (research, outline, sections, QA,
# metadata, optional hero image), used only for the pre-start cap check.
ARTICLE_ESTIMATE_USD = Decimal("0.80")

Spawn = Callable[[str, str, str, str], Awaitable[None] | None]


class BulkRefused(ValueError):
    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def parse_keywords(raw: list[str] | str) -> list[str]:
    """One keyword per line (or list entry): trimmed, deduplicated
    case-insensitively, order kept. Raises ``BulkRefused``."""
    items = raw.splitlines() if isinstance(raw, str) else list(raw)
    out: list[str] = []
    seen: set[str] = set()
    for k in items:
        k = seo_meta.clean_text(k if isinstance(k, str) else "")
        if not k:
            continue
        if len(k) > 200:
            raise BulkRefused(f"Keep each keyword under 200 characters (“{k[:40]}…”).")
        if k.lower() in seen:
            continue
        seen.add(k.lower())
        out.append(k)
    if not out:
        raise BulkRefused("Add at least one keyword.")
    limit = settings.article_bulk_max_keywords
    if len(out) > limit:
        raise BulkRefused(f"A batch takes at most {limit} keywords ({len(out)} given).")
    return out


async def _spend_context(user_id: str, niche_id: UUID, cap):
    from ..services.spend_context import default_context

    return await default_context(user_id=user_id, niche_id=niche_id, job_id=None, cap_usd=cap)


async def create(*, user_id: str, niche_id: UUID, keywords: list[str] | str, created_by: str) -> batches_repo.Batch:
    from ..repos import niches as niches_repo

    niche = await niches_repo.get(niche_id, user_id=user_id)
    if niche is None:
        raise BulkRefused("playbook not found", 404)
    clean = parse_keywords(keywords)
    cap = niche.daily_spend_cap_usd
    if cap is not None and Decimal(str(cap)) < ARTICLE_ESTIMATE_USD:
        raise BulkRefused(
            f"This playbook's daily cap (${cap}) is below what one article costs (about ${ARTICLE_ESTIMATE_USD}).",
            402,
        )
    return await batches_repo.create(user_id=user_id, niche_id=niche_id, keywords=clean, created_by=created_by)


async def _default_claim(key: str) -> bool:
    from ..services import idempotency

    return await idempotency.claim_spawn(key)


async def tick_batch(
    batch_id: UUID, *, user_id: str, spawn: Spawn,
    claim: Callable[[str], Awaitable[bool]] = _default_claim,
) -> dict[str, int]:
    """Advance one batch. Returns {'started': n, 'held': 0|1}."""
    from ..repos import niches as niches_repo
    from ..repos.spend import SpendCapExceeded

    batch = await batches_repo.get(batch_id, user_id=user_id)
    if batch is None or batch.status in ("done", "cancelled"):
        return {"started": 0, "held": 0}
    await batches_repo.reconcile_running(batch_id)
    counts = await batches_repo.counts(batch_id)
    running, queued = counts.get("running", 0), counts.get("queued", 0)
    if queued == 0:
        if running == 0:
            await batches_repo.set_status(batch_id, "done")
        return {"started": 0, "held": 0}
    slots = max(0, settings.article_bulk_concurrency - running)
    if slots == 0:
        return {"started": 0, "held": 0}

    niche = await niches_repo.get(batch.niche_id, user_id=user_id)
    if niche is None:
        await batches_repo.cancel(batch_id, user_id=user_id)
        return {"started": 0, "held": 0}

    started = 0
    for item in await batches_repo.next_queued(batch_id, limit=slots):
        spend = await _spend_context(user_id, batch.niche_id, niche.daily_spend_cap_usd)
        try:
            await spend.ensure_can_spend(ARTICLE_ESTIMATE_USD)
        except SpendCapExceeded as exc:
            await batches_repo.hold_queued(batch_id, "spend_cap")
            await batches_repo.set_status(batch_id, "paused_cap")
            log.info("bulk batch waiting for spend cap", extra={"batch_id": str(batch_id), "scope": getattr(exc, "scope", "")})
            return {"started": started, "held": 1}
        if not await batches_repo.claim_item(item.id):
            continue
        if not await claim(f"article_batch_item:{item.id}"):
            continue
        try:
            article = await articles_repo.create(
                user_id=user_id, niche_id=batch.niche_id, topic=item.keyword, batch_id=batch_id,
            )
            await batches_repo.attach_article(item.id, article.id)
            result = spawn(user_id, str(batch.niche_id), str(article.id), item.keyword)
            if result is not None:
                await result
            started += 1
        except Exception as exc:  # noqa: BLE001 - one item never stops the batch
            log.warning("bulk item did not start", extra={"item_id": str(item.id), "error": type(exc).__name__})
            await batches_repo.fail_item(item.id, f"did not start: {type(exc).__name__}")
    if started:
        await batches_repo.hold_queued(batch_id, None)
        await batches_repo.set_status(batch_id, "running")
    return {"started": started, "held": 0}


async def tick_all(*, spawn: Spawn) -> dict[str, int]:
    started = held = 0
    for batch_id, user_id in await batches_repo.open_batch_ids():
        try:
            r = await tick_batch(batch_id, user_id=user_id, spawn=spawn)
            started += r["started"]
            held += r["held"]
        except Exception:  # noqa: BLE001
            log.warning("bulk tick failed for a batch", extra={"batch_id": str(batch_id)}, exc_info=True)
    return {"started": started, "held": held}


def modal_spawn(user_id: str, niche_id: str, article_id: str, topic: str) -> None:
    import modal

    fn = modal.Function.from_name("marketer-sh", "run_article_pipeline")
    fn.spawn(user_id, niche_id, article_id, topic)
