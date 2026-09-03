"""SEO auditor endpoints — score a URL for AI answer-engine readability.

- POST   /api/v1/seo-audits              — run an audit (SYNCHRONOUS, ~10-40s)
- GET    /api/v1/seo-audits              — recent audits (summaries)
- GET    /api/v1/seo-audits/{id}         — one stored audit, full result
- GET    /api/v1/seo-audits/{id}/prompt  — text/plain agent fix prompt download
- DELETE /api/v1/seo-audits/{id}         — 204

Everything is user-scoped through the auth context; lookups that miss (or
belong to someone else) 404.

The POST is deliberately synchronous — the whole audit is two Context.dev
scrapes plus pure-CPU scoring, so there is no job row to poll and the caller
gets the result in one round trip. Clients must set a generous read timeout.
Repeat audits of the same URL are served from the stored row while it is
younger than `seo_audit_cache_ttl_sec`, unless `refresh` is true.

Feature-off and unconfigured-vendor both surface as 409, never a 500; a
vendor outage surfaces as 502.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from marketer.config import settings
from marketer.repos import seo_audits as seo_audits_repo
from marketer.seoaudit import audit as seo_audit
from marketer.seoaudit.types import AuditResult
from marketer.services.context_dev import ContextDevUnavailable

from ..auth import AuthCtx, CurrentUser
from ..hosted_safety import refuse_unbilled_generate

router = APIRouter()


class SeoAuditRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    #: Skip the stored-audit cache and re-scrape.
    refresh: bool = False


class SeoAuditSummary(BaseModel):
    """List-view row: no result blob."""

    id: UUID
    url: str
    host: str
    score: float
    band: str
    created_at: datetime


class StoredAudit(SeoAuditSummary):
    """One audit plus its full scored result."""

    #: True when this response came from the stored-audit cache.
    cached: bool = False
    audit: AuditResult


def _to_stored(row: dict, *, cached: bool) -> StoredAudit:
    return StoredAudit(
        id=row["id"],
        url=row["url"],
        host=row["host"],
        score=float(row["score"]),
        band=row["band"],
        created_at=row["created_at"],
        cached=cached,
        audit=AuditResult.model_validate(row["result"]),
    )


@router.get("", response_model=list[SeoAuditSummary])
async def list_seo_audits(
    ctx: AuthCtx = CurrentUser,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[SeoAuditSummary]:
    rows = await seo_audits_repo.list_for_user(ctx.user_id, limit=limit)
    return [
        SeoAuditSummary(
            id=row["id"],
            url=row["url"],
            host=row["host"],
            score=float(row["score"]),
            band=row["band"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.post("", response_model=StoredAudit)
async def run_seo_audit(
    body: SeoAuditRequest, ctx: AuthCtx = CurrentUser
) -> StoredAudit:
    try:
        seo_audit.ensure_enabled()
    except seo_audit.SeoAuditDisabled as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    url = seo_audit.normalize_audit_url(body.url)
    if not url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "enter a valid URL")

    cache_key = seo_audit.audit_cache_key(url)
    if not body.refresh:
        cached = await seo_audits_repo.find_fresh(
            user_id=ctx.user_id,
            cache_key=cache_key,
            max_age_sec=settings.seo_audit_cache_ttl_sec,
        )
        if cached:
            return _to_stored(cached, cached=True)

    refuse_unbilled_generate()
    try:
        result = await seo_audit.run_audit(url)
    except ContextDevUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    row = await seo_audits_repo.create(
        user_id=ctx.user_id,
        url=result.url,
        host=result.host,
        cache_key=cache_key,
        schema_version=seo_audit.CACHE_SCHEMA_VERSION,
        score=result.score,
        band=result.band.label,
        result=result.model_dump(mode="json"),
    )
    return _to_stored(row, cached=False)


@router.get("/{audit_id}", response_model=StoredAudit)
async def get_seo_audit(audit_id: UUID, ctx: AuthCtx = CurrentUser) -> StoredAudit:
    row = await seo_audits_repo.get(audit_id, user_id=ctx.user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return _to_stored(row, cached=True)


@router.get("/{audit_id}/prompt")
async def get_seo_audit_prompt(
    audit_id: UUID, ctx: AuthCtx = CurrentUser
) -> PlainTextResponse:
    """The full agent fix prompt, as a downloadable text file."""
    row = await seo_audits_repo.get(audit_id, user_id=ctx.user_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    result = AuditResult.model_validate(row["result"])
    prompt = result.agent_prompts.full
    if not prompt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "audit has no fix prompt")
    filename = f"seo-audit-{row['host']}-{audit_id}.txt"
    return PlainTextResponse(
        prompt,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{audit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_seo_audit(audit_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    if not await seo_audits_repo.delete(audit_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
