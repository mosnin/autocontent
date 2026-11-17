"""Workspace: the cross-department surface (Home, Inbox, Activity).

- GET  /api/v1/workspace/overview?days=30            — KPIs, series, pipeline, top content
- GET  /api/v1/workspace/inbox                       — everything awaiting the user
- POST /api/v1/workspace/inbox/{kind}/{ref_id}/decide — approve / reject one item
- POST /api/v1/workspace/required-actions/{id}/resolve — a person says what
                                                       happened to an unknown outcome
- GET  /api/v1/workspace/activity?limit=&before=     — merged recent events

Reads go through ``marketer.repos.workspace`` (SQL lives there). Decisions
dispatch to the exact functions the department routes use (jobs approve /
reject, image-posts approve / reject, ads approvals decide), so guardrails,
atomic claims and the ad audit trail are identical whichever surface the
user (or the agent, via delegated auth) acts from.

Money is serialized as strings with two decimals, like the rest of the API.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from marketer.rails.http import rails_request_context
from marketer.rails.store import get_store as rails_store
from marketer.repos import ad_approvals
from marketer.repos import workspace as workspace_repo

from ..auth import AuthCtx, CurrentUser
from . import ads as ads_routes
from . import image_posts as image_posts_routes
from . import jobs as jobs_routes

router = APIRouter(dependencies=[Depends(rails_request_context)])
log = logging.getLogger(__name__)

_CENT = Decimal("0.01")


def _money(v: Decimal | int | float | str | None) -> str:
    return str(Decimal(str(v or 0)).quantize(_CENT, rounding=ROUND_HALF_UP))


def _short_money(v: Decimal | None) -> str:
    """'$20' for whole dollars, '$20.50' otherwise (for one-line details)."""
    d = Decimal(str(v or 0)).quantize(_CENT, rounding=ROUND_HALF_UP)
    return f"${d:.0f}" if d == d.to_integral_value() else f"${d}"


# --------------------------------------------------------------------------- models


class WorkspaceKpis(BaseModel):
    total_spend_usd: str
    content_spend_usd: str
    ad_spend_usd: str
    posts_published: int
    articles_published: int
    views: int
    engagements: int
    ad_clicks: int
    ad_conversions: int


class WorkspaceSeriesPoint(BaseModel):
    day: date
    content_spend_usd: str
    ad_spend_usd: str
    views: int
    posts: int


class PipelineDept(BaseModel):
    active: int
    done: int
    failed: int


class PipelineAds(BaseModel):
    active_campaigns: int
    pending_approvals: int


class WorkspacePipeline(BaseModel):
    content: PipelineDept
    seo: PipelineDept
    ads: PipelineAds


class TopContentItem(BaseModel):
    kind: Literal["video", "article", "carousel"]
    id: str
    title: str
    platform: str | None = None
    views: int | None = None
    created_at: datetime


class WorkspaceOverview(BaseModel):
    days: int
    kpis: WorkspaceKpis
    previous_kpis: WorkspaceKpis
    series: list[WorkspaceSeriesPoint]
    pipeline: WorkspacePipeline
    top_content: list[TopContentItem]


InboxKind = Literal["video", "carousel", "ad_change"]


class InboxItem(BaseModel):
    id: str
    kind: InboxKind
    ref_id: str
    title: str
    detail: str
    niche_id: str | None = None
    created_at: datetime


class InboxCounts(BaseModel):
    total: int
    video: int
    carousel: int
    ad_change: int
    # Added with the rails (0027). `total` still counts `items` only, so
    # existing clients see exactly what they saw before.
    required_action: int = 0


class RequiredAction(BaseModel):
    """Something only a person can settle (docs/rails/required-actions.md).

    Today one kind: ``indeterminate_outcome``, a publish or spend whose result
    is unknown (sent, then a timeout). The agent can read these and pass the
    link on; it cannot resolve them."""

    id: str
    kind: Literal["indeterminate_outcome"] = "indeterminate_outcome"
    action: str
    title: str
    detail: str
    target_type: str
    target_id: str
    principal: str
    created_at: datetime
    resolve_path: str
    resolutions: list[str] = ["confirmed_succeeded", "confirmed_failed"]


class WorkspaceInbox(BaseModel):
    items: list[InboxItem]
    counts: InboxCounts
    required_actions: list[RequiredAction] = []


class DecideBody(BaseModel):
    decision: Literal["approve", "reject"]


class DecideResult(BaseModel):
    ok: bool
    kind: InboxKind
    ref_id: str
    decision: Literal["approve", "reject"]


class ActivityEvent(BaseModel):
    id: str
    at: datetime
    kind: Literal["video", "article", "carousel", "ad_action", "approval", "campaign"]
    status: str
    title: str
    detail: str
    ref_id: str


class WorkspaceActivity(BaseModel):
    events: list[ActivityEvent]
    next_before: datetime | None = None


# --------------------------------------------------------------------------- overview


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _midnight(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=timezone.utc)


def _kpis(raw: dict) -> WorkspaceKpis:
    content = Decimal(str(raw["content_spend_usd"]))
    ads = Decimal(str(raw["ad_spend_usd"]))
    return WorkspaceKpis(
        total_spend_usd=_money(content + ads),
        content_spend_usd=_money(content),
        ad_spend_usd=_money(ads),
        posts_published=raw["posts_published"],
        articles_published=raw["articles_published"],
        views=raw["views"],
        engagements=raw["engagements"],
        ad_clicks=raw["ad_clicks"],
        # ad_metrics_daily.conversions is numeric (platforms report fractional
        # conversions); the contract is an integer count, so round half-up.
        ad_conversions=int(
            Decimal(str(raw["ad_conversions"])).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        ),
    )


@router.get("/overview", response_model=WorkspaceOverview)
async def overview(
    days: int = Query(default=30, ge=1, le=365), ctx: AuthCtx = CurrentUser
) -> WorkspaceOverview:
    """One view across organic video, carousels, articles and paid ads.

    The window is the last ``days`` UTC calendar days including today;
    ``previous_kpis`` covers the ``days`` before that. ``series`` has one
    zero-filled row per day, oldest first; its ``views`` is views gained that
    day, while ``kpis.views`` is the sum of each post's latest sample in the
    window."""
    today = _utc_today()
    first_day = today - timedelta(days=days - 1)
    start, end = _midnight(first_day), _midnight(today + timedelta(days=1))
    prev_start = start - timedelta(days=days)

    current = await workspace_repo.window_kpis(ctx.user_id, start=start, end=end)
    previous = await workspace_repo.window_kpis(ctx.user_id, start=prev_start, end=start)
    by_day = await workspace_repo.daily_series(ctx.user_id, start=start, end=end)
    pipeline = await workspace_repo.pipeline_counts(ctx.user_id, start=start, end=end)
    top = await workspace_repo.top_content(ctx.user_id, start=start, end=end, limit=8)

    series: list[WorkspaceSeriesPoint] = []
    for i in range(days):
        day = first_day + timedelta(days=i)
        row = by_day.get(day) or {}
        series.append(
            WorkspaceSeriesPoint(
                day=day,
                content_spend_usd=_money(row.get("content_spend_usd")),
                ad_spend_usd=_money(row.get("ad_spend_usd")),
                views=int(row.get("views") or 0),
                posts=int(row.get("posts") or 0),
            )
        )

    return WorkspaceOverview(
        days=days,
        kpis=_kpis(current),
        previous_kpis=_kpis(previous),
        series=series,
        pipeline=WorkspacePipeline.model_validate(pipeline),
        top_content=[TopContentItem.model_validate(t) for t in top],
    )


# --------------------------------------------------------------------------- inbox


def _ad_change_title(row: dict) -> str:
    base = {
        "budget.change": "Budget change",
        "campaign.activate": "Activate campaign",
    }.get(row["action"], row.get("summary") or row["action"])
    name = row.get("campaign_name")
    return f"{base}: {name}" if name else base


def _ad_change_detail(row: dict) -> str:
    """One line a person can approve from, e.g.
    'Raise daily budget $20 → $35 on Spring sale'."""
    name = row.get("campaign_name")
    on = f" on {name}" if name else ""
    payload = row.get("payload") or {}
    current = row.get("campaign_daily_budget_usd")
    if row["action"] == "budget.change" and payload.get("new_daily_budget_usd") is not None:
        new = Decimal(str(payload["new_daily_budget_usd"]))
        if current is None:
            return f"Set daily budget to {_short_money(new)}{on}"
        old = Decimal(str(current))
        verb = "Raise" if new > old else "Lower" if new < old else "Keep"
        return f"{verb} daily budget {_short_money(old)} → {_short_money(new)}{on}"
    if row["action"] == "campaign.activate":
        budget = f" at {_short_money(current)}/day" if current is not None else ""
        target = name or "campaign"
        return f"Activate {target}{budget}"
    return row.get("summary") or row["action"]


def _content_detail(platform: str | None, niche_title: str | None) -> str:
    return " · ".join(p for p in (platform, niche_title) if p)


def _inbox_item(row: dict) -> InboxItem:
    source = row["source"]
    ref = str(row["id"])
    if source == "ad_change":
        niche = row.get("niche_id")
        return InboxItem(
            id=f"ad_change:{ref}", kind="ad_change", ref_id=ref,
            title=_ad_change_title(row), detail=_ad_change_detail(row),
            niche_id=str(niche) if niche else None, created_at=row["created_at"],
        )
    return InboxItem(
        id=f"{source}:{ref}", kind=source, ref_id=ref,
        title=row.get("title") or source.capitalize(),
        detail=_content_detail(row.get("platform"), row.get("niche_title")),
        niche_id=str(row["niche_id"]) if row.get("niche_id") else None,
        created_at=row["created_at"],
    )


_REQUIRED_ACTION_TITLES = {
    "content.post.send": "We can't confirm the post went out",
    "content.video.approve": "We can't confirm the video was sent for posting",
    "content.carousel.approve": "We can't confirm the carousel was sent for posting",
    "ads.budget.change": "We can't confirm the budget change reached the ad platform",
    "ads.campaign.activate": "We can't confirm the campaign was activated",
    "ads.approval.execute": "We can't confirm the approved ad change was applied",
    "campaigns.start": "We can't confirm the campaign started",
}


def _required_action(row) -> RequiredAction:
    title = _REQUIRED_ACTION_TITLES.get(row.action, "We can't confirm an action went through")
    where = f"{row.target_type} {row.target_id}".strip()
    return RequiredAction(
        id=str(row.id), action=row.action, title=title,
        detail=f"Check {where or 'the platform'} before trying again. Nothing will retry on its own.",
        target_type=row.target_type, target_id=row.target_id, principal=row.principal,
        created_at=row.created_at,
        resolve_path=f"/api/v1/workspace/required-actions/{row.id}/resolve",
    )


@router.get("/inbox", response_model=WorkspaceInbox)
async def inbox(ctx: AuthCtx = CurrentUser) -> WorkspaceInbox:
    """Videos and carousels awaiting approval plus pending ad spend changes,
    newest first, and the rails' Required Actions (unknown outcomes)."""
    rows = await workspace_repo.inbox_items(ctx.user_id)
    items = [_inbox_item(r) for r in rows]
    items.sort(key=lambda i: i.created_at, reverse=True)
    try:
        required = [_required_action(r) for r in await rails_store().open_required_actions(ctx.user_id)]
    except Exception:  # noqa: BLE001 - a read; the inbox must still load
        log.warning("rails: could not read required actions", exc_info=True)
        required = []
    return WorkspaceInbox(
        items=items,
        counts=InboxCounts(
            total=len(items),
            video=sum(1 for i in items if i.kind == "video"),
            carousel=sum(1 for i in items if i.kind == "carousel"),
            ad_change=sum(1 for i in items if i.kind == "ad_change"),
            required_action=len(required),
        ),
        required_actions=required,
    )


class ResolveBody(BaseModel):
    resolution: Literal["confirmed_succeeded", "confirmed_failed"]


class ResolveResult(BaseModel):
    ok: bool
    id: str
    resolution: str


@router.post("/required-actions/{action_id}/resolve", response_model=ResolveResult)
async def resolve_required_action(
    action_id: str, body: ResolveBody, ctx: AuthCtx = CurrentUser
) -> ResolveResult:
    """A person records what actually happened to an unknown outcome.

    Only a person: the agent (delegated auth) gets 403, because "did the post
    go out?" is exactly the question an agent must not answer for itself.
    Resolving unblocks new dispatches on the same target. 404 when not found
    or already resolved."""
    if ctx.delegated:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only a person can resolve a required action; share the inbox link",
        )
    try:
        execution_id = UUID(action_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "required action not found") from None
    row = await rails_store().resolve(
        ctx.user_id, execution_id, resolution=body.resolution,
        resolved_by=ctx.email or ctx.user_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "required action not found or already resolved")
    return ResolveResult(ok=True, id=action_id, resolution=body.resolution)


@router.post("/inbox/{kind}/{ref_id}/decide", response_model=DecideResult)
async def decide_inbox_item(
    kind: str, ref_id: str, body: DecideBody, ctx: AuthCtx = CurrentUser
) -> DecideResult:
    """Approve or reject one inbox item by dispatching to the department's
    own logic. 404 when the item doesn't exist or isn't the caller's; 409
    when it's no longer awaiting a decision (same as the department routes).
    """
    if kind not in ("video", "carousel", "ad_change"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown inbox kind {kind!r}")
    try:
        item_id = UUID(ref_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "item not found") from None

    approve = body.decision == "approve"
    if kind == "video":
        if approve:
            await jobs_routes.approve_job(item_id, ctx)
        else:
            await jobs_routes.reject_job(item_id, ctx)
    elif kind == "carousel":
        if approve:
            await image_posts_routes.approve_image_post(item_id, ctx)
        else:
            await image_posts_routes.reject_image_post(item_id, ctx)
    else:
        # The ads decide path answers 409 for both "missing" and "already
        # decided"; the inbox contract wants 404 for missing / not owned.
        if await ad_approvals.get(item_id, user_id=ctx.user_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "approval not found")
        await ads_routes.decide_ad_approval(
            item_id, "approved" if approve else "rejected", ctx
        )
    return DecideResult(ok=True, kind=kind, ref_id=ref_id, decision=body.decision)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- activity


def _humanize(action: str) -> str:
    return action.replace(".", " ").replace("_", " ").capitalize()


def _activity_event(row: dict) -> ActivityEvent:
    source = row["source"]
    ref = str(row["id"])
    at = row["at"]
    if source in ("video", "article", "carousel"):
        st = row["status"]
        parts = [row.get("platform"), row.get("niche_title")]
        if st == "failed" and row.get("error"):
            parts.append(str(row["error"])[:200])
        return ActivityEvent(
            id=f"{'job' if source == 'video' else source}:{ref}:{st}", at=at,
            kind=source, status=st, title=row.get("title") or source.capitalize(),
            detail=" · ".join(p for p in parts if p), ref_id=ref,
        )
    if source == "ad_action":
        delta = Decimal(str(row.get("dollar_delta_usd") or 0))
        parts = [row.get("actor"), row.get("platform")]
        if row.get("target_type"):
            parts.append(f"{row['target_type']} {row.get('target_id') or ''}".strip())
        if delta:
            parts.append(f"{'+' if delta > 0 else '-'}{_short_money(abs(delta))}/day")
        return ActivityEvent(
            id=f"ad_action:{ref}", at=at, kind="ad_action", status=row["action"],
            title=_humanize(row["action"]),
            detail=" · ".join(p for p in parts if p),
            ref_id=row.get("target_id") or ref,
        )
    if source == "approval":
        st = row["status"]
        who = row.get("decided_by") or ""
        return ActivityEvent(
            id=f"approval:{ref}:{st}", at=at, kind="approval", status=st,
            title=row.get("summary") or _humanize(row["action"]),
            detail=f"{st} by {who}" if who else st, ref_id=ref,
        )
    # campaign
    st = row["status"]
    detail = row.get("objective") or ""
    if row.get("budget_usd") is not None:
        budget = f"budget {_short_money(row['budget_usd'])}"
        detail = f"{detail} · {budget}" if detail else budget
    return ActivityEvent(
        id=f"campaign:{ref}:{st}", at=at, kind="campaign", status=st,
        title=row.get("name") or "Campaign", detail=detail, ref_id=ref,
    )


@router.get("/activity", response_model=WorkspaceActivity)
async def activity(
    limit: int = Query(default=50, ge=1, le=200),
    before: datetime | None = None,
    ctx: AuthCtx = CurrentUser,
) -> WorkspaceActivity:
    """Recent events across departments, newest first. Page with
    ``before=<next_before>``; ``next_before`` is null on the last page.
    (Events sharing the exact boundary timestamp may straddle pages.)"""
    if before is not None and before.tzinfo is None:
        before = before.replace(tzinfo=timezone.utc)
    rows = await workspace_repo.activity_events(ctx.user_id, before=before, limit=limit)
    events = [_activity_event(r) for r in rows]
    next_before = events[-1].at if len(events) == limit else None
    return WorkspaceActivity(events=events, next_before=next_before)
