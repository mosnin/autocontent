"""SEO articles: metadata edits, Unsplash covers, WordPress publishing and
scheduling (docs/seo-articles.md). Mounted at ``/api/v1/articles`` beside
``articles.py``; every path here has a suffix, so the two never overlap.

Permissions (backend/policy.py): edits and covers ``content:update``;
publish, schedule, move and unschedule ``content:publish``. Publishing runs
through the rails (``articles/publishing.py``)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.articles import publishing, seo_meta
from marketer.articles.models import Article, ArticleStatus
from marketer.rails import OutcomeUnknown, RailsDenied, principal_of
from marketer.rails.http import rails_request_context, to_http
from marketer.repos import article_seo
from marketer.repos import articles as articles_repo
from marketer.services import unsplash

from .. import audit
from ..auth import AuthCtx, CurrentUser
from ..security import user_rate_limit

router = APIRouter(dependencies=[Depends(rails_request_context)])


async def _owned(article_id: UUID, ctx: AuthCtx) -> Article:
    article = await articles_repo.get(article_id, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return article


# ── Metadata ─────────────────────────────────────────────────────────────────


class SeoMetaBody(BaseModel):
    meta_title: str = Field(max_length=200)
    meta_description: str = Field(max_length=400)
    slug: str = Field(max_length=200)
    focus_keyword: str = Field(max_length=200)
    secondary_keywords: list[str] = Field(default_factory=list, max_length=20)


@router.patch("/{article_id}/seo", response_model=Article)
async def update_seo(article_id: UUID, body: SeoMetaBody, ctx: AuthCtx = CurrentUser) -> Article:
    """Replace the article's SEO metadata. Refused with field errors (422)
    rather than shortened: the person sees what to fix."""
    article = await _owned(article_id, ctx)
    if article.status != ArticleStatus.done:
        raise HTTPException(status.HTTP_409_CONFLICT, "the article is still being written")
    if article.publish_status in ("publishing", "unknown"):
        raise HTTPException(status.HTTP_409_CONFLICT, "the article is being published; wait for it to finish")
    secondary = [seo_meta.clean_text(k) for k in body.secondary_keywords if seo_meta.clean_text(k)]
    errors = seo_meta.validate(
        meta_title=body.meta_title, meta_description=body.meta_description, slug=body.slug.strip(),
        focus_keyword=body.focus_keyword, secondary_keywords=secondary,
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"errors": errors})
    out = await article_seo.set_seo_meta(
        article_id, user_id=ctx.user_id, meta_title=seo_meta.clean_text(body.meta_title),
        meta_description=seo_meta.clean_text(body.meta_description), slug=body.slug.strip(),
        focus_keyword=seo_meta.clean_text(body.focus_keyword), secondary_keywords=secondary,
    )
    if out is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return out


# ── Cover (Unsplash) ─────────────────────────────────────────────────────────


@router.get("/{article_id}/cover/search", dependencies=[user_rate_limit("articles.cover_search", "30/minute")])
async def search_cover(
    article_id: UUID, q: str = Query(default="", max_length=100), ctx: AuthCtx = CurrentUser,
) -> dict:
    article = await _owned(article_id, ctx)
    if not unsplash.enabled():
        raise HTTPException(status.HTTP_409_CONFLICT, "Unsplash isn't set up on this server")
    query = seo_meta.clean_text(q) or article.focus_keyword or article.topic
    try:
        photos = await unsplash.search(query)
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unsplash didn't answer; try again") from exc
    return {"query": query, "photos": [p.model_dump(exclude={"download_location"}) for p in photos]}


class CoverBody(BaseModel):
    photo_id: str = Field(min_length=1, max_length=64)


@router.put("/{article_id}/cover", response_model=Article)
async def set_cover(article_id: UUID, body: CoverBody, ctx: AuthCtx = CurrentUser) -> Article:
    """Use an Unsplash photo as the cover. The photo is re-read from Unsplash
    by id; nothing the browser sends about it is stored."""
    await _owned(article_id, ctx)
    if not unsplash.enabled():
        raise HTTPException(status.HTTP_409_CONFLICT, "Unsplash isn't set up on this server")
    try:
        photo = await unsplash.get_photo(body.photo_id)
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unsplash didn't answer; try again") from exc
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
    await unsplash.track_download(photo)
    out = await article_seo.set_cover(article_id, user_id=ctx.user_id, cover=unsplash.cover_record(photo))
    if out is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return out


@router.delete("/{article_id}/cover", response_model=Article)
async def remove_cover(article_id: UUID, ctx: AuthCtx = CurrentUser) -> Article:
    await _owned(article_id, ctx)
    out = await article_seo.set_cover(article_id, user_id=ctx.user_id, cover=None)
    if out is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return out


# ── Publishing ───────────────────────────────────────────────────────────────


def _publish_error(exc: publishing.PublishError) -> HTTPException:
    return HTTPException(exc.status_code, f"{exc.code}: {exc.message}")


class PublishBody(BaseModel):
    mode: Literal["draft", "live"] = "draft"
    # Live only: when set, the article is scheduled instead of sent now.
    publish_at: datetime | None = None


@router.post("/{article_id}/publish", response_model=Article, dependencies=[user_rate_limit("articles.publish", "20/minute")])
async def publish_article(article_id: UUID, body: PublishBody, ctx: AuthCtx = CurrentUser) -> Article:
    """Send a draft, publish live now, or (with ``publish_at``) schedule a
    live publish. Through the rails: kill switch, unknown outcomes,
    idempotency key, execution record."""
    principal = principal_of(ctx)
    try:
        if body.publish_at is not None:
            if body.mode != "live":
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "only a live publish can be scheduled")
            out = await publishing.schedule(
                user_id=ctx.user_id, article_id=article_id, publish_at=body.publish_at, principal=principal,
            )
            await audit.record(
                ctx, "content.article.scheduled", outcome="success", target_type="article",
                target_id=str(article_id), metadata={"publish_at": out.publish_at.isoformat() if out.publish_at else None},
            )
            return out
        return await publishing.publish(
            user_id=ctx.user_id, article_id=article_id, mode=body.mode, principal=principal,
            actor_email=ctx.actor_email or ctx.email,
        )
    except publishing.PublishError as exc:
        if exc.code == "person_required":
            await audit.record(ctx, "content.article.publish", outcome="denied", target_type="article", target_id=str(article_id), metadata={"code": exc.code})
        raise _publish_error(exc) from exc
    except (RailsDenied, OutcomeUnknown) as exc:
        raise to_http(exc) from exc


class RescheduleBody(BaseModel):
    publish_at: datetime


@router.patch("/{article_id}/schedule", response_model=Article)
async def reschedule_article(article_id: UUID, body: RescheduleBody, ctx: AuthCtx = CurrentUser) -> Article:
    """Move a scheduled publish to another time (the calendar's drag)."""
    try:
        out = await publishing.reschedule(
            user_id=ctx.user_id, article_id=article_id, publish_at=body.publish_at, principal=principal_of(ctx),
        )
    except publishing.PublishError as exc:
        raise _publish_error(exc) from exc
    await audit.record(
        ctx, "content.article.rescheduled", outcome="success", target_type="article", target_id=str(article_id),
        metadata={"publish_at": out.publish_at.isoformat() if out.publish_at else None},
    )
    return out


@router.delete("/{article_id}/schedule", response_model=Article)
async def unschedule_article(article_id: UUID, ctx: AuthCtx = CurrentUser) -> Article:
    out = await article_seo.unschedule(article_id, user_id=ctx.user_id)
    if out is None:
        await _owned(article_id, ctx)
        raise HTTPException(status.HTTP_409_CONFLICT, "the article isn't scheduled")
    await audit.record(ctx, "content.article.unscheduled", outcome="success", target_type="article", target_id=str(article_id))
    return out

