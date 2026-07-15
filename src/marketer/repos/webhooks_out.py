"""Outbound webhook endpoint registry (per-user)."""
from __future__ import annotations

import secrets as _secrets
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from ..db import get_pool

VALID_EVENTS = frozenset({
    "job.done", "job.failed", "job.awaiting_approval",
    "article.done", "article.failed",
})


class WebhookEndpoint(BaseModel):
    id: UUID
    user_id: str
    url: str
    events: list[str]
    enabled: bool
    description: str
    last_status: int | None = None
    last_delivery_at: datetime | None = None
    created_at: datetime
    # secret is returned ONLY at creation time (see create()).
    secret: str | None = None


_COLS = (
    "id, user_id, url, events, enabled, description, last_status, "
    "last_delivery_at, created_at"
)


def new_secret() -> str:
    return "whsec_" + _secrets.token_urlsafe(32)


async def create(
    *, user_id: str, url: str, events: list[str], description: str = ""
) -> WebhookEndpoint:
    secret = new_secret()
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into webhook_endpoints (user_id, url, secret, events, description)
        values ($1, $2, $3, $4, $5)
        returning {_COLS}
        """,
        user_id, url, secret, events, description,
    )
    ep = WebhookEndpoint(**dict(row))
    ep.secret = secret  # one-time reveal
    return ep


async def list_for_user(user_id: str) -> list[WebhookEndpoint]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_COLS} from webhook_endpoints where user_id = $1 order by created_at desc",
        user_id,
    )
    return [WebhookEndpoint(**dict(r)) for r in rows]


async def get(endpoint_id: UUID, *, user_id: str) -> WebhookEndpoint | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from webhook_endpoints where id = $1 and user_id = $2",
        endpoint_id, user_id,
    )
    return WebhookEndpoint(**dict(row)) if row else None


async def set_enabled(
    endpoint_id: UUID, *, user_id: str, enabled: bool
) -> WebhookEndpoint | None:
    """Enable or disable delivery for one endpoint. Disabled endpoints are
    skipped by deliverable_for_event but keep their history and secret, so a
    later re-enable resumes with the same signing secret."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update webhook_endpoints set enabled = $3
         where id = $1 and user_id = $2
        returning {_COLS}
        """,
        endpoint_id, user_id, enabled,
    )
    return WebhookEndpoint(**dict(row)) if row else None


async def delete(endpoint_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from webhook_endpoints where id = $1 and user_id = $2",
        endpoint_id, user_id,
    )
    return result.split()[-1] == "1"


async def deliverable_for_event(user_id: str, event: str) -> list[tuple[str, str]]:
    """Return (url, secret) for every enabled endpoint of the user subscribed
    to `event` (empty events array = all events). Used by the delivery
    service — includes the secret, so keep it server-side only."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select url, secret from webhook_endpoints
         where user_id = $1 and enabled
           and (cardinality(events) = 0 or $2 = any(events))
        """,
        user_id, event,
    )
    return [(r["url"], r["secret"]) for r in rows]


async def record_delivery(endpoint_url: str, user_id: str, status_code: int | None) -> None:
    """Best-effort: stamp the last delivery status for the user's endpoints
    matching this URL. Never raises into the delivery path."""
    pool = await get_pool()
    await pool.execute(
        """
        update webhook_endpoints set last_status = $3, last_delivery_at = now()
         where user_id = $1 and url = $2
        """,
        user_id, endpoint_url, status_code,
    )
