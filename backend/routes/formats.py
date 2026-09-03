"""Video formats + trend research.

- GET  /api/v1/formats               — the format catalog (pick one)
- GET  /api/v1/formats/trends        — recent trend reports
- POST /api/v1/formats/trends        — start a research run (202, async, metered)
- GET  /api/v1/formats/trends/{id}   — one report: themes, hooks, sources, angles
- GET  /api/v1/formats/{key}         — one format in full (beats + voice direction)

The two catalog endpoints are pure functions over in-process data: no
LLM call, no DB, nothing metered. They still go through the normal auth
dependency so the whole API has one story about who may call it.

ROUTE ORDER MATTERS HERE. FastAPI matches routes in declaration order,
and `/{key}` is a catch-all that would happily swallow `/trends` — a GET
of the report list would return a 404 for "unknown video format:
trends", and the POST would 405. Every `/trends*` route is therefore
declared BEFORE `/{key}`, and must stay there. (Declaring `/{key}` last
is the fix; there is no ordering-independent version of this that keeps
both under the same prefix.)

Research is spawned on Modal rather than run inline: it is one metered
LLM call plus up to three search round trips, which is well past a
comfortable request timeout. The POST returns 202 with the queued row,
and the client polls the detail endpoint.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from marketer.formats import registry
from marketer.repos import niches as niches_repo
from marketer.repos import trend_reports as reports_repo
from marketer.research.trends import TrendReport

from ..auth import AuthCtx, CurrentUser
from ..hosted_safety import refuse_unbilled_generate

router = APIRouter()

_MODAL_APP = "marketer-sh"
_MODAL_FN = "run_trend_research"


# ------------------------------------------------------------------ schemas


class TrendRunRequest(BaseModel):
    niche_id: UUID


class TrendReportRow(BaseModel):
    """List-view row: status and provenance, no findings blob."""

    id: UUID
    niche_id: UUID
    status: str
    #: False when search was unconfigured/unavailable and the findings are
    #: model knowledge only. The UI badges these; it must never present
    #: them as sourced.
    grounded: bool
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class TrendReportDetail(TrendReportRow):
    """One report plus its findings (themes, hooks, sources, angles)."""

    report: TrendReport


def _row(row: dict) -> TrendReportRow:
    return TrendReportRow(
        id=row["id"],
        niche_id=row["niche_id"],
        status=row["status"],
        grounded=bool(row["grounded"]),
        error=row.get("error"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _detail(row: dict) -> TrendReportDetail:
    # A queued/failed row has `{}` for its report; every TrendReport field
    # has a default, so this validates into an empty report rather than
    # forcing the client to special-case in-flight runs.
    return TrendReportDetail(
        **_row(row).model_dump(),
        report=TrendReport.model_validate(row.get("report") or {}),
    )


def _spawn(user_id: str, report_id: UUID) -> None:
    import modal

    fn = modal.Function.from_name(_MODAL_APP, _MODAL_FN)
    fn.spawn(user_id, str(report_id))


# ------------------------------------------------------------------ catalog


@router.get("", response_model=list[registry.FormatSummary])
async def list_formats(ctx: AuthCtx = CurrentUser) -> list[registry.FormatSummary]:
    """The catalog: key, label, description, beat shape, duration, best-for."""
    return registry.summaries()


# ------------------------------------------------------------------ trends
#
# Declared before `/{key}` — see the module docstring. Moving these below
# the catch-all silently breaks every trend endpoint.


@router.get("/trends", response_model=list[TrendReportRow])
async def list_trend_reports(
    niche_id: UUID | None = None,
    limit: int = Query(default=25, ge=1, le=200),
    ctx: AuthCtx = CurrentUser,
) -> list[TrendReportRow]:
    rows = await reports_repo.list_for_user(ctx.user_id, niche_id=niche_id, limit=limit)
    return [_row(r) for r in rows]


@router.post(
    "/trends",
    response_model=TrendReportRow,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_trend_research(
    body: TrendRunRequest, ctx: AuthCtx = CurrentUser
) -> TrendReportRow:
    """Queue a research run for one niche and return the row immediately."""
    refuse_unbilled_generate()
    # Ownership is checked before the row is created: without this a
    # caller could seed reports against another tenant's niche id, and
    # the background run would then spend against that niche's cap.
    if await niches_repo.get(body.niche_id, user_id=ctx.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "niche not found")

    row = await reports_repo.create(user_id=ctx.user_id, niche_id=body.niche_id)
    _spawn(ctx.user_id, row["id"])
    return _row(row)


@router.get("/trends/{report_id}", response_model=TrendReportDetail)
async def get_trend_report(
    report_id: UUID, ctx: AuthCtx = CurrentUser
) -> TrendReportDetail:
    row = await reports_repo.get(report_id, user_id=ctx.user_id)
    if row is None:
        # 404 rather than 403 for someone else's report, so ids can't be
        # probed for existence.
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return _detail(row)


# ------------------------------------------------------------------ one format
#
# LAST on purpose: `/{key}` matches anything, including "trends".


@router.get("/{key}", response_model=registry.FormatDetail)
async def get_format(key: str, ctx: AuthCtx = CurrentUser) -> registry.FormatDetail:
    """One format in full: beat contract, pacing, and voice direction."""
    fmt = registry.get_format(key)
    if fmt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown video format: {key}")
    return registry.detail(fmt)
