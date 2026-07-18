"""Newsletter digest repo -- per-user settings + generated digest history.

Two tables (migration 0023):
  - newsletter_settings: one row per user, upserted from
    PUT /api/v1/newsletters/settings. ``send_to`` empty means "fall back
    to the account email at send time" -- resolved by the caller
    (services.newsletter_cron / routes.newsletters), not here.
  - newsletter_digests: one row per composed digest, 'draft' until
    services.newsletter.send flips it to 'sent'/'failed'.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from ..db import get_pool


class NewsletterSettings(BaseModel):
    user_id: str
    enabled: bool = False
    cadence: str = "weekly"  # 'weekly' | 'biweekly' | 'monthly'
    send_to: str = ""
    last_sent_at: datetime | None = None


class NewsletterDigest(BaseModel):
    id: UUID
    user_id: str
    subject: str = ""
    markdown: str = ""
    html: str = ""
    article_ids: list[UUID] = Field(default_factory=list)
    status: str = "draft"  # 'draft' | 'sent' | 'failed'
    error: str = ""
    created_at: datetime | None = None
    sent_at: datetime | None = None


_SETTINGS_COLS = "user_id, enabled, cadence, send_to, last_sent_at"
_DIGEST_COLS = (
    "id, user_id, subject, markdown, html, article_ids, status, error, "
    "created_at, sent_at"
)


# ---------------------------------------------------------------------------
# newsletter_settings
# ---------------------------------------------------------------------------


async def get_settings(user_id: str) -> NewsletterSettings | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_SETTINGS_COLS} from newsletter_settings where user_id = $1", user_id
    )
    return NewsletterSettings(**dict(row)) if row else None


async def upsert_settings(
    user_id: str, *, enabled: bool, cadence: str, send_to: str
) -> NewsletterSettings:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into newsletter_settings (user_id, enabled, cadence, send_to)
        values ($1, $2, $3, $4)
        on conflict (user_id) do update set
            enabled = excluded.enabled,
            cadence = excluded.cadence,
            send_to = excluded.send_to
        returning {_SETTINGS_COLS}
        """,
        user_id, enabled, cadence, send_to,
    )
    return NewsletterSettings(**dict(row))


async def list_enabled_settings() -> list[NewsletterSettings]:
    """Every user with newsletters enabled -- the cron's candidate pool.
    Cadence-window and new-article filtering happen in newsletter_cron
    (they need article data this repo has no business querying)."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_SETTINGS_COLS} from newsletter_settings where enabled = true"
    )
    return [NewsletterSettings(**dict(r)) for r in rows]


async def mark_sent_at(user_id: str, *, when: datetime) -> None:
    pool = await get_pool()
    await pool.execute(
        "update newsletter_settings set last_sent_at = $2 where user_id = $1",
        user_id, when,
    )


# ---------------------------------------------------------------------------
# newsletter_digests
# ---------------------------------------------------------------------------


async def create_digest(
    *,
    user_id: str,
    subject: str,
    markdown: str,
    html: str,
    article_ids: list[UUID],
) -> NewsletterDigest:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into newsletter_digests (user_id, subject, markdown, html, article_ids)
        values ($1, $2, $3, $4, $5)
        returning {_DIGEST_COLS}
        """,
        user_id, subject, markdown, html, article_ids,
    )
    return NewsletterDigest(**dict(row))


async def get_digest(digest_id: UUID, *, user_id: str) -> NewsletterDigest | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_DIGEST_COLS} from newsletter_digests where id = $1 and user_id = $2",
        digest_id, user_id,
    )
    return NewsletterDigest(**dict(row)) if row else None


async def list_digests(user_id: str, *, limit: int = 50) -> list[NewsletterDigest]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_DIGEST_COLS} from newsletter_digests
         where user_id = $1
         order by created_at desc
         limit $2
        """,
        user_id, limit,
    )
    return [NewsletterDigest(**dict(r)) for r in rows]


async def mark_sent(digest_id: UUID, *, sent_at: datetime) -> NewsletterDigest | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update newsletter_digests
           set status = 'sent', sent_at = $2, error = ''
         where id = $1
        returning {_DIGEST_COLS}
        """,
        digest_id, sent_at,
    )
    return NewsletterDigest(**dict(row)) if row else None


async def mark_failed(digest_id: UUID, *, error: str) -> NewsletterDigest | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update newsletter_digests
           set status = 'failed', error = $2
         where id = $1
        returning {_DIGEST_COLS}
        """,
        digest_id, error[:2000],
    )
    return NewsletterDigest(**dict(row)) if row else None
