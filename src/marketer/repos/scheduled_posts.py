"""Scheduled-post queue persistence (see db/migrations/0031_scheduled_posts.sql).

Two tables and one template table:

``scheduled_posts``            the calendar item (copy, media, UTC instant)
``scheduled_post_variants``    one row per target platform, with its own
                               copy/media override *and its own status*
``recurring_slots``            weekday+local-time templates

Everything here is user-scoped: every read and write carries `user_id` in
the WHERE clause, so a guessed UUID from another tenant returns nothing
rather than someone else's post.

The two statements that matter for correctness are `claim_due` and
`claim_variant`. Both are single atomic UPDATEs with the current status in
the WHERE clause, mirroring `repos/image_posts.py::claim_for_scheduling`:
exactly one caller can win the transition, so two dispatcher containers
racing the same due post cannot both reach Ayrshare with it.
"""
from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from ..db import get_pool
from ..scheduling.schemas import (
    MUTABLE_POST_STATUSES,
    RecurringSlot,
    RecurringSlotCreate,
    ScheduledPost,
    ScheduledPostCreate,
    ScheduledPostUpdate,
    VariantOverride,
)

# Statuses a post may be deleted from: never dispatched, or dispatched and
# wholly unsuccessful. A `dispatching` post may be mid-flight to a real
# account and a `partial`/`posted` one has live posts we cannot recall, so
# deleting either would destroy the only record of what went out.
DELETABLE_STATUSES = ("scheduled", "failed")

_REAP_VARIANT_ERROR = (
    "reaped: dispatcher died mid-publish; delivery outcome unknown — not retried "
    "automatically to avoid a double post"
)
_REAP_POST_ERROR = "reaped: dispatcher died mid-dispatch"

_WITH_VARIANTS = """
    coalesce(
        (select jsonb_agg(to_jsonb(v) order by v.platform)
           from scheduled_post_variants v
          where v.scheduled_post_id = p.id),
        '[]'::jsonb
    ) as variants
"""


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _post(row) -> ScheduledPost:
    d = dict(row)
    d["media_urls"] = _json(d.get("media_urls")) or []
    d["variants"] = _json(d.get("variants")) or []
    return ScheduledPost.model_validate(d)


def _variant_payload(
    platforms: list[str], variants: dict[str, VariantOverride]
) -> str:
    """Fan-out rows as jsonb so parent + variants insert in ONE statement —
    no read-then-write window in which a post exists with no destinations."""
    rows = []
    for p in platforms:
        ov = variants.get(p)
        rows.append(
            {
                "platform": p,
                "content": None if ov is None else ov.content,
                "media_urls": None if ov is None or ov.media_urls is None else ov.media_urls,
            }
        )
    return json.dumps(rows)


# --------------------------------------------------------------------------
# create / read
# --------------------------------------------------------------------------

async def create(
    body: ScheduledPostCreate,
    *,
    user_id: str,
    source: str = "manual",
    recurring_slot_id: UUID | None = None,
) -> ScheduledPost:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        with parent as (
            insert into scheduled_posts
                (user_id, content, media_urls, scheduled_at, timezone,
                 source, recurring_slot_id)
            values ($1, $2, $3::jsonb, $4, $5, $6, $7)
            returning *
        ), fanout as (
            insert into scheduled_post_variants
                (scheduled_post_id, platform, content, media_urls)
            select parent.id, x.platform, x.content, x.media_urls
              from parent,
                   jsonb_to_recordset($8::jsonb)
                     as x(platform text, content text, media_urls jsonb)
            returning *
        )
        select p.*,
               coalesce((select jsonb_agg(to_jsonb(f) order by f.platform)
                           from fanout f), '[]'::jsonb) as variants
          from parent p
        """,
        user_id,
        body.content,
        json.dumps(body.media_urls),
        body.scheduled_at,
        body.timezone,
        source,
        recurring_slot_id,
        _variant_payload(body.platforms, body.variants),
    )
    return _post(row)


async def get(post_id: UUID, *, user_id: str) -> ScheduledPost | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select p.*, {_WITH_VARIANTS} from scheduled_posts p "
        "where p.id = $1 and p.user_id = $2",
        post_id, user_id,
    )
    return _post(row) if row else None


async def list_for_user(
    user_id: str,
    *,
    status: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 50,
) -> list[ScheduledPost]:
    """Window/status listing. `status='due'` is a derived filter (scheduled
    and past its time) rather than a stored value — see schemas.PostStatus."""
    due_only = status == "due"
    stored_status = None if due_only or not status else status
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select p.*, {_WITH_VARIANTS}
          from scheduled_posts p
         where p.user_id = $1
           and ($2::text is null or p.status = $2)
           and ($3::timestamptz is null or p.scheduled_at >= $3)
           and ($4::timestamptz is null or p.scheduled_at < $4)
           and (not $5::boolean or (p.status = 'scheduled' and p.scheduled_at <= now()))
         order by p.scheduled_at
         limit $6
        """,
        user_id, stored_status, start, end, due_only, limit,
    )
    return [_post(r) for r in rows]


# --------------------------------------------------------------------------
# update / delete
# --------------------------------------------------------------------------

class ConflictError(RuntimeError):
    """The row exists but is not in a state that allows this change."""

    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


async def update(
    post_id: UUID, *, user_id: str, patch: ScheduledPostUpdate
) -> ScheduledPost | None:
    """Partial update, including the drag-to-reschedule move.

    Wrapped in one transaction because a platform-set change is several
    statements and a half-applied edit (new copy, old destinations) would
    ship the wrong thing.

    Rescheduling a post that already failed resets it to `scheduled` and
    re-arms only the variants that FAILED. Variants already `posted` stay
    posted: those are live on someone's real account and re-arming them is
    exactly how a reschedule turns into a double post.
    """
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        current = await conn.fetchrow(
            "select status from scheduled_posts where id = $1 and user_id = $2 for update",
            post_id, user_id,
        )
        if current is None:
            return None
        if current["status"] not in MUTABLE_POST_STATUSES:
            raise ConflictError(current["status"])

        rearm = patch.scheduled_at is not None and current["status"] != "scheduled"
        await conn.execute(
            """
            update scheduled_posts
               set content       = coalesce($3, content),
                   media_urls    = coalesce($4::jsonb, media_urls),
                   scheduled_at  = coalesce($5, scheduled_at),
                   timezone      = coalesce($6, timezone),
                   status        = case when $7::boolean then 'scheduled' else status end,
                   error         = case when $7::boolean then null else error end,
                   updated_at    = now()
             where id = $1 and user_id = $2
            """,
            post_id, user_id, patch.content,
            None if patch.media_urls is None else json.dumps(patch.media_urls),
            patch.scheduled_at, patch.timezone, rearm,
        )
        if rearm:
            await conn.execute(
                """
                update scheduled_post_variants
                   set status = 'pending', error = null, updated_at = now()
                 where scheduled_post_id = $1 and status = 'failed'
                """,
                post_id,
            )

        if patch.platforms is not None:
            # Only undelivered destinations may be dropped — removing a
            # platform we already posted to would erase the provider post id.
            await conn.execute(
                """
                delete from scheduled_post_variants
                 where scheduled_post_id = $1
                   and status = 'pending'
                   and not (platform = any($2::text[]))
                """,
                post_id, patch.platforms,
            )
            await conn.execute(
                """
                insert into scheduled_post_variants (scheduled_post_id, platform)
                select $1, x from unnest($2::text[]) as x
                on conflict (scheduled_post_id, platform) do nothing
                """,
                post_id, patch.platforms,
            )

        for platform, ov in (patch.variants or {}).items():
            await conn.execute(
                """
                update scheduled_post_variants
                   set content = $3,
                       media_urls = $4::jsonb,
                       updated_at = now()
                 where scheduled_post_id = $1 and platform = $2 and status = 'pending'
                """,
                post_id, platform, ov.content,
                None if ov.media_urls is None else json.dumps(ov.media_urls),
            )

        row = await conn.fetchrow(
            f"select p.*, {_WITH_VARIANTS} from scheduled_posts p "
            "where p.id = $1 and p.user_id = $2",
            post_id, user_id,
        )
    return _post(row) if row else None


async def delete(post_id: UUID, *, user_id: str) -> str | None:
    """Delete an undispatched post. Returns None on success, or the blocking
    status when the post exists but must not be deleted."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        with victim as (
            select id, status from scheduled_posts
             where id = $1 and user_id = $2
        ), gone as (
            delete from scheduled_posts
             where id = (select id from victim where status = any($3::text[]))
            returning id
        )
        select (select status from victim) as status,
               (select count(*) from gone) as deleted
        """,
        post_id, user_id, list(DELETABLE_STATUSES),
    )
    if row is None or row["status"] is None:
        return "not_found"
    return None if row["deleted"] else row["status"]


# --------------------------------------------------------------------------
# dispatch claims — the double-post guards
# --------------------------------------------------------------------------

async def claim_due(*, now: datetime, limit: int = 50) -> list[ScheduledPost]:
    """Atomically move up to `limit` due posts `scheduled` -> `dispatching`
    and return them.

    Selection and claim are ONE statement: a second dispatcher running the
    same tick sees the rows already gone (`status = 'scheduled'` no longer
    matches) and gets an empty list. `for update skip locked` keeps two
    concurrent dispatchers from serialising on the same rows instead of
    dividing the work.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        with due as (
            select id from scheduled_posts
             where status = 'scheduled' and scheduled_at <= $1
             order by scheduled_at
             limit $2
             for update skip locked
        ), claimed as (
            update scheduled_posts s
               set status = 'dispatching', updated_at = now()
              from due
             where s.id = due.id
            returning s.*
        )
        select p.*, {_WITH_VARIANTS} from claimed p order by p.scheduled_at
        """,
        now, limit,
    )
    return [_post(r) for r in rows]


async def claim_for_publish_now(post_id: UUID, *, user_id: str) -> ScheduledPost | None:
    """Atomic `scheduled` -> `dispatching` ignoring the clock (the
    publish-now button). Same WHERE-status claim, so a double-click
    publishes once."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        with claimed as (
            update scheduled_posts
               set status = 'dispatching', updated_at = now()
             where id = $1 and user_id = $2 and status = 'scheduled'
            returning *
        )
        select p.*, {_WITH_VARIANTS} from claimed p
        """,
        post_id, user_id,
    )
    return _post(row) if row else None


async def claim_variant(variant_id: UUID) -> bool:
    """Atomic per-platform `pending` -> `dispatching`.

    The per-post claim alone is not enough: a post that partially failed can
    legitimately be dispatched again, and only this second claim stops the
    platforms that already went out from going out twice.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        update scheduled_post_variants
           set status = 'dispatching', updated_at = now()
         where id = $1 and status = 'pending'
        returning id
        """,
        variant_id,
    )
    return row is not None


async def mark_variant_posted(variant_id: UUID, *, provider_post_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        update scheduled_post_variants
           set status = 'posted', provider_post_id = $2, error = null,
               dispatched_at = now(), updated_at = now()
         where id = $1
        """,
        variant_id, provider_post_id,
    )


async def mark_variant_failed(variant_id: UUID, *, error: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        update scheduled_post_variants
           set status = 'failed', error = $2, updated_at = now()
         where id = $1
        """,
        variant_id, error[:2000],
    )


async def finalize(post_id: UUID) -> ScheduledPost | None:
    """Roll the variant statuses up into the parent once dispatch is done."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        with agg as (
            select count(*) filter (where status = 'posted') as ok,
                   count(*) filter (where status = 'failed') as bad,
                   count(*) filter (where status in ('pending', 'dispatching')) as open
              from scheduled_post_variants where scheduled_post_id = $1
        ), rolled as (
            update scheduled_posts s
               set status = case
                       when agg.open > 0 then 'dispatching'
                       when agg.bad = 0 then 'posted'
                       when agg.ok = 0 then 'failed'
                       else 'partial' end,
                   error = case when agg.bad > 0
                                then agg.bad || ' platform(s) failed' else null end,
                   updated_at = now()
              from agg
             where s.id = $1
            returning s.*
        )
        select p.*, {_WITH_VARIANTS} from rolled p
        """,
        post_id,
    )
    return _post(row) if row else None


async def reap_stale(*, older_than_minutes: int = 60) -> int:
    """Rescue posts stranded in `dispatching` by a crashed dispatcher.

    Mirrors `repos/image_posts.py::reap_stale`, with one deliberate
    difference: a stranded variant is reaped to `failed`, never back to
    `pending`. We died *around* a call to a social platform and genuinely do
    not know whether it landed. Auto-retrying an unknown outcome is how you
    double-post; parking it as failed makes a human look and decide.
    """
    pool = await get_pool()
    await pool.execute(
        """
        update scheduled_post_variants
           set status = 'failed', error = $1, updated_at = now()
         where status = 'dispatching'
           and updated_at < now() - make_interval(mins => $2)
        """,
        _REAP_VARIANT_ERROR, older_than_minutes,
    )
    result = await pool.execute(
        """
        update scheduled_posts s
           set status = case
                   when exists (select 1 from scheduled_post_variants v
                                 where v.scheduled_post_id = s.id and v.status = 'posted')
                   then 'partial' else 'failed' end,
               error = $1, updated_at = now()
         where s.status = 'dispatching'
           and s.updated_at < now() - make_interval(mins => $2)
        """,
        _REAP_POST_ERROR, older_than_minutes,
    )
    return int(result.split()[-1])


# --------------------------------------------------------------------------
# recurring slot templates
# --------------------------------------------------------------------------

async def create_slot(body: RecurringSlotCreate, *, user_id: str) -> RecurringSlot:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        insert into recurring_slots
            (user_id, label, weekday, hour, minute, timezone, platforms, active)
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        returning *
        """,
        user_id, body.label, body.weekday, body.hour, body.minute,
        body.timezone, json.dumps(body.platforms), body.active,
    )
    return _slot(row)


async def list_slots(user_id: str, *, active_only: bool = False) -> list[RecurringSlot]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select * from recurring_slots
         where user_id = $1 and (not $2::boolean or active)
         order by weekday, hour, minute
        """,
        user_id, active_only,
    )
    return [_slot(r) for r in rows]


async def delete_slot(slot_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    row = await pool.fetchrow(
        "delete from recurring_slots where id = $1 and user_id = $2 returning id",
        slot_id, user_id,
    )
    return row is not None


def _slot(row) -> RecurringSlot:
    d = dict(row)
    d["platforms"] = _json(d.get("platforms")) or []
    return RecurringSlot.model_validate(d)
