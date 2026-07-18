"""Newsletter digests — generation, scheduling, sending (Team Newsletters).

Registered in main.py at /api/v1/newsletters. Settings + digest CRUD live
here; composition/sending logic itself is in
marketer.services.newsletter (compose/send) and
marketer.services.newsletter_cron (the hourly autopilot pass).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from marketer.articles.models import ArticleStatus
from marketer.repos import articles as articles_repo
from marketer.repos import brand_kit as brand_kit_repo
from marketer.repos import newsletters as newsletters_repo
from marketer.repos import users as users_repo
from marketer.repos.newsletters import NewsletterDigest, NewsletterSettings
from marketer.repos.spend import SpendCapExceeded
from marketer.services.newsletter import compose, send
from marketer.services.spend_context import default_context

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

_CADENCES = ("weekly", "biweekly", "monthly")


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingsUpdate(BaseModel):
    enabled: bool
    cadence: str
    send_to: str | None = None


@router.get("/settings", response_model=NewsletterSettings)
async def get_settings(ctx: AuthCtx = CurrentUser) -> NewsletterSettings:
    settings_row = await newsletters_repo.get_settings(ctx.user_id)
    return settings_row or NewsletterSettings(user_id=ctx.user_id)


@router.put("/settings", response_model=NewsletterSettings)
async def put_settings(body: SettingsUpdate, ctx: AuthCtx = CurrentUser) -> NewsletterSettings:
    if body.cadence not in _CADENCES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"cadence must be one of {', '.join(_CADENCES)}",
        )
    return await newsletters_repo.upsert_settings(
        ctx.user_id,
        enabled=body.enabled,
        cadence=body.cadence,
        send_to=body.send_to or "",
    )


# ---------------------------------------------------------------------------
# Compose / send
# ---------------------------------------------------------------------------


@router.post("/compose", response_model=NewsletterDigest, status_code=status.HTTP_201_CREATED)
async def compose_digest(ctx: AuthCtx = CurrentUser) -> NewsletterDigest:
    """Compose a draft digest right now from the user's done articles
    since their last sent digest (or all done articles, if they've never
    been sent one). Persists as 'draft' and returns it -- does NOT send.
    Use POST /{digest_id}/send to actually mail it."""
    user = await users_repo.get(ctx.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    settings_row = await newsletters_repo.get_settings(ctx.user_id)
    since = settings_row.last_sent_at if settings_row else None

    done = await articles_repo.list_for_user(ctx.user_id, status=ArticleStatus.done, limit=200)
    new_articles = [
        a for a in done if since is None or (a.created_at is not None and a.created_at > since)
    ]
    if not new_articles:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "no new done articles since the last digest"
        )

    brand = await brand_kit_repo.get(ctx.user_id)
    spend = await default_context(user_id=ctx.user_id, niche_id=None, job_id=None, cap_usd=None)
    try:
        composed = await compose(user, new_articles, brand, spend=spend)
    except SpendCapExceeded as exc:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc)) from exc

    return await newsletters_repo.create_digest(
        user_id=ctx.user_id,
        subject=composed.subject,
        markdown=composed.markdown,
        html=composed.html,
        article_ids=composed.article_ids,
    )


@router.post("/{digest_id}/send", response_model=NewsletterDigest)
async def send_digest(digest_id: UUID, ctx: AuthCtx = CurrentUser) -> NewsletterDigest:
    digest = await newsletters_repo.get_digest(digest_id, user_id=ctx.user_id)
    if digest is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if digest.status == "sent":
        raise HTTPException(status.HTTP_409_CONFLICT, "digest already sent")

    settings_row = await newsletters_repo.get_settings(ctx.user_id)
    to = (settings_row.send_to if settings_row else "") or ctx.email
    return await send(digest, to)


# ---------------------------------------------------------------------------
# Digest listing
# ---------------------------------------------------------------------------


@router.get("", response_model=list[NewsletterDigest])
async def list_digests(
    ctx: AuthCtx = CurrentUser, limit: int = Query(default=50, ge=1, le=200)
) -> list[NewsletterDigest]:
    return await newsletters_repo.list_digests(ctx.user_id, limit=limit)


@router.get("/{digest_id}", response_model=NewsletterDigest)
async def get_digest(digest_id: UUID, ctx: AuthCtx = CurrentUser) -> NewsletterDigest:
    digest = await newsletters_repo.get_digest(digest_id, user_id=ctx.user_id)
    if digest is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return digest
