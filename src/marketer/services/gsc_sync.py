"""Hourly Google Search Console data sync (Team GSC).

Wired into ``press_growth_cron`` in modal_app.py, which already isolates
this module's exceptions from its sibling scans. Within a run, a single
user's failure (revoked refresh token, a stale Google API error, ...) is
additionally isolated here too, so one bad connection never starves the
sync for everyone else.

Cheap no-op when GSC isn't configured (checked before touching the DB) or
when a connection has no site_url chosen yet.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from ..repos import gsc as gsc_repo
from ..repos.gsc import GscConnection
from . import gsc as gsc_service

log = logging.getLogger(__name__)

# Trailing window (re)pulled every run. Small and overlapping on purpose:
# Google's Search Analytics data can lag/backfill a day or two, and
# gsc_daily's upsert makes re-pulling already-synced days idempotent, so a
# short generous window is cheaper and safer than trying to track "since
# last sync" state precisely.
SYNC_DAYS = 3


async def run() -> dict:
    """Refresh stale tokens and pull the last SYNC_DAYS days of (date,
    query, page) rows for every connected+site-selected user. Returns
    per-run counts; never raises."""
    if not gsc_service.is_enabled():
        return {"skipped": "gsc not configured"}

    connections = await gsc_repo.list_all_connections()
    synced = 0
    failed = 0
    rows_written = 0
    for conn in connections:
        if not conn.site_url:
            continue
        try:
            rows_written += await _sync_one(conn)
            synced += 1
        except Exception:  # noqa: BLE001 — one user's failure must not stop the rest
            failed += 1
            log.exception("gsc_sync: sync failed for user %s", conn.user_id)
    return {
        "connections": len(connections),
        "synced": synced,
        "failed": failed,
        "rows": rows_written,
    }


async def ensure_fresh_access_token(conn: GscConnection) -> str:
    """Return a live access token for *conn*, refreshing (and persisting)
    it first if it's missing or expired. Shared by the sync job and the
    POST /site route, which also needs a live token to verify site access."""
    now = datetime.now(timezone.utc)
    if conn.access_token and conn.token_expires_at and conn.token_expires_at > now:
        return conn.access_token
    tokens = await gsc_service.refresh_access_token(refresh_token=conn.refresh_token)
    expires_at = now + timedelta(seconds=tokens.expires_in)
    await gsc_repo.set_tokens(
        conn.user_id,
        access_token=tokens.access_token,
        token_expires_at=expires_at,
        refresh_token=tokens.refresh_token,
    )
    return tokens.access_token


async def _sync_one(conn: GscConnection) -> int:
    access_token = await ensure_fresh_access_token(conn)

    end = date.today()
    start = end - timedelta(days=SYNC_DAYS - 1)
    raw_rows = await gsc_service.query_search_analytics(
        access_token=access_token,
        site_url=conn.site_url,
        start_date=start.isoformat(),
        end_date=end.isoformat(),
        dimensions=["date", "query", "page"],
        row_limit=25000,
    )
    rows = [row for raw in raw_rows if (row := _to_daily_row(raw)) is not None]
    return await gsc_repo.upsert_daily(conn.user_id, rows)


def _to_daily_row(raw: dict) -> dict | None:
    keys = raw.get("keys") or []
    if len(keys) < 3:
        return None
    try:
        day = date.fromisoformat(keys[0])
    except ValueError:
        return None
    return {
        "date": day,
        "query": keys[1],
        "page": keys[2],
        "clicks": raw.get("clicks", 0),
        "impressions": raw.get("impressions", 0),
        "ctr": raw.get("ctr", 0),
        "position": raw.get("position", 0),
    }
