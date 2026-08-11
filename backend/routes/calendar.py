"""Content calendar — unified scheduled-content feed for the authed user."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, status

from marketer.repos import calendar as calendar_repo
from marketer.repos.calendar import CalendarItem

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


@router.get("", response_model=list[CalendarItem])
async def calendar(
    ctx: AuthCtx = CurrentUser,
    start: datetime | None = None,
    end: datetime | None = None,
    days: int = Query(default=30, ge=1, le=120),
) -> list[CalendarItem]:
    """Scheduled videos + article activity in a window. Defaults to the next
    `days` from now; pass explicit start/end to page any range."""
    now = datetime.now(timezone.utc)
    if start is None:
        start = now
    if end is None:
        end = start + timedelta(days=days)
    if end <= start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "end must be after start")
    if (end - start) > timedelta(days=180):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "window too large (max 180 days)")
    return await calendar_repo.items_for_user(ctx.user_id, start=start, end=end)
