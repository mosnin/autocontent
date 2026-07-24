"""Studio generations: the server-side history the Studio surfaces read.

Every query is scoped by ``user_id`` — there is no unscoped read or write
here, so a generation id belonging to someone else is indistinguishable
from one that does not exist (404, never a leak).

History is keyset-paginated on ``(created_at, id)``: an opaque cursor
beats OFFSET because new generations land at the head of the list while
the user is scrolling, and OFFSET would silently repeat or skip rows.
"""
from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from ..db import get_pool
from ..models import StudioGeneration


class InvalidCursor(ValueError):
    """The history cursor is not one we issued."""


def _row(row) -> StudioGeneration:
    d = dict(row)
    for key in ("params", "outputs"):
        if isinstance(d.get(key), str):
            d[key] = json.loads(d[key])
    return StudioGeneration.model_validate(d)


def encode_cursor(created_at: datetime, generation_id: UUID) -> str:
    raw = f"{created_at.isoformat()}|{generation_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    padding = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        stamp, _, gen_id = raw.partition("|")
        return datetime.fromisoformat(stamp), UUID(gen_id)
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise InvalidCursor(f"malformed history cursor: {cursor!r}") from exc


async def create(
    *,
    user_id: str,
    kind: str,
    model: str,
    params: dict,
) -> StudioGeneration:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into studio_generations (user_id, kind, model, params)
        values ($1, $2, $3, $4::jsonb)
        returning *
        """,
        user_id, kind, model, json.dumps(params),
    )
    return _row(row)


async def get(generation_id: UUID, *, user_id: str) -> StudioGeneration | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "select * from studio_generations where id = $1 and user_id = $2",
        generation_id, user_id,
    )
    return _row(row) if row else None


async def list_for_user(
    *,
    user_id: str,
    kind: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[StudioGeneration], str | None]:
    """One page of history, newest first, plus the cursor for the next
    page (None when this page is the last)."""
    before_created_at: datetime | None = None
    before_id: UUID | None = None
    if cursor:
        before_created_at, before_id = decode_cursor(cursor)

    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from studio_generations
         where user_id = $1
           and ($2::text is null or kind = $2)
           and ($3::timestamptz is null
                or (created_at, id) < ($3::timestamptz, $4::uuid))
         order by created_at desc, id desc
         limit $5
        """,
        user_id, kind, before_created_at, before_id, limit + 1,
    )
    page = [_row(r) for r in rows[:limit]]
    next_cursor = (
        encode_cursor(page[-1].created_at, page[-1].id)
        if len(rows) > limit and page
        else None
    )
    return page, next_cursor


async def claim_for_run(generation_id: UUID, *, user_id: str) -> bool:
    """Atomic queued -> running claim, so a duplicate spawn (retry, double
    delivery) can never run — and pay for — the same generation twice."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update studio_generations set status = 'running', updated_at = now()
         where id = $1 and user_id = $2 and status = 'queued'
        returning id
        """,
        generation_id, user_id,
    )
    return row is not None


async def set_provider(
    generation_id: UUID,
    *,
    user_id: str,
    provider: str,
    provider_request_id: str | None = None,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        update studio_generations
           set provider = $3, provider_request_id = $4, updated_at = now()
         where id = $1 and user_id = $2
        """,
        generation_id, user_id, provider, provider_request_id,
    )


async def complete(
    generation_id: UUID,
    *,
    user_id: str,
    outputs: list[dict],
    cost_usd: Decimal,
) -> StudioGeneration | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update studio_generations
           set status = 'done', outputs = $3::jsonb, cost_usd = $4,
               error = null, updated_at = now()
         where id = $1 and user_id = $2
        returning *
        """,
        generation_id, user_id, json.dumps(outputs), cost_usd,
    )
    return _row(row) if row else None


async def fail(
    generation_id: UUID,
    *,
    user_id: str,
    error: str,
    cost_usd: Decimal = Decimal("0"),
) -> StudioGeneration | None:
    """Mark a generation failed with an explanatory message.

    ``cost_usd`` is passed when the failure happened *after* a provider
    charged us — the money is already spent and the audit trail must show
    it rather than pretend a failed generation was free.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update studio_generations
           set status = 'failed', error = $3, cost_usd = $4, updated_at = now()
         where id = $1 and user_id = $2
        returning *
        """,
        generation_id, user_id, error, cost_usd,
    )
    return _row(row) if row else None


async def delete(generation_id: UUID, *, user_id: str) -> bool:
    """Remove one generation from the user's history. Returns False when
    the row does not exist or belongs to someone else."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "delete from studio_generations where id = $1 and user_id = $2 returning id",
        generation_id, user_id,
    )
    return row is not None


_REAPABLE_STATUSES = ("queued", "running")
_REAP_ERROR = "reaped: no progress (worker died or timed out mid-generation)"


async def reap_stale(*, older_than_minutes: int = 60) -> int:
    """Fail generations stuck non-terminal with no progress — a crashed
    container otherwise strands them 'running' forever and the history
    panel spins on a poll that will never resolve."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update studio_generations
           set status = 'failed', error = $2, updated_at = now()
         where status = any($1::text[])
           and updated_at < now() - make_interval(mins => $3)
        """,
        list(_REAPABLE_STATUSES), _REAP_ERROR, older_than_minutes,
    )
    return int(result.split()[-1])
