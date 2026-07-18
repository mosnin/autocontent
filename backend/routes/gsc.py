"""Google Search Console — OAuth connect, rankings, queries, content gaps
(Team GSC).

Every route is user_id-scoped. ``services/gsc.py`` calls can raise
``GscDisabled`` (feature unconfigured -> 409) or ``GscApiError`` (the
feature IS configured but a specific Google call failed -> 502); neither is
ever swallowed into a fake success.

GET /callback is the one exception to "auth via AuthCtx": it's a top-level
browser navigation Google redirects to directly, so there's no
``Authorization`` header to check. Instead the signed ``state`` param (see
``services/gsc.sign_state`` / ``verify_state``) carries the initiating
user's id, HMAC-signed with the OAuth client secret so it can't be forged
or replayed after expiry.

Registered in main.py at /api/v1/gsc.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from marketer.repos import gsc as gsc_repo
from marketer.services import gsc as gsc_service
from marketer.services import gsc_sync
from marketer.services.gsc import GscApiError, GscDisabled

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

_CALLBACK_PATH = "api/v1/gsc/callback"
# GSC property URL prefixes Google actually issues (domain properties or a
# verified URL-prefix property).
_VALID_SITE_PREFIXES = ("sc-domain:", "sc-https:", "http://", "https://")


def _redirect_uri(request: Request) -> str:
    """The callback URL registered with the Google OAuth client — derived
    from the incoming request rather than a hardcoded setting, so this works
    unchanged across local/staging/prod hosts (it must still be an exact
    match of what's configured in the Google Cloud console)."""
    return f"{request.base_url}{_CALLBACK_PATH}"


# --------------------------------------------------------------------------- connect / callback

class ConnectResponse(BaseModel):
    authorize_url: str
    state: str


@router.get("/connect", response_model=ConnectResponse)
async def connect(
    request: Request,
    return_to: str = Query(default="", description="Relative frontend path to redirect to after connecting"),
    ctx: AuthCtx = CurrentUser,
) -> ConnectResponse:
    if return_to and not return_to.startswith("/"):
        raise HTTPException(422, "return_to must be a relative path")
    try:
        state = gsc_service.sign_state(user_id=ctx.user_id, return_to=return_to)
        url = gsc_service.authorize_url(redirect_uri=_redirect_uri(request), state=state)
    except GscDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    return ConnectResponse(authorize_url=url, state=state)


@router.get("/callback", response_model=None)
async def callback(
    request: Request,
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
) -> dict | RedirectResponse:
    if error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"google oauth error: {error}")
    if not code or not state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing code or state")
    try:
        payload = gsc_service.verify_state(state)
        tokens = await gsc_service.exchange_code(code=code, redirect_uri=_redirect_uri(request))
    except GscDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except GscApiError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    expires_at = _now_plus(tokens.expires_in)
    await gsc_repo.upsert_connection(
        user_id=payload.user_id,
        refresh_token=tokens.refresh_token,
        access_token=tokens.access_token,
        token_expires_at=expires_at,
    )

    if payload.return_to:
        return RedirectResponse(f"{payload.return_to}?gsc_connected=1")
    return {"connected": True}


def _now_plus(seconds: int):
    from datetime import datetime, timezone

    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


# --------------------------------------------------------------------------- status / site / connection

class StatusResponse(BaseModel):
    connected: bool
    site_url: str = ""


@router.get("/status", response_model=StatusResponse)
async def status_(ctx: AuthCtx = CurrentUser) -> StatusResponse:
    conn = await gsc_repo.get_connection(ctx.user_id)
    if conn is None:
        return StatusResponse(connected=False)
    return StatusResponse(connected=True, site_url=conn.site_url)


class SiteBody(BaseModel):
    site_url: str = Field(min_length=1)


@router.post("/site", response_model=StatusResponse)
async def set_site(body: SiteBody, ctx: AuthCtx = CurrentUser) -> StatusResponse:
    if not body.site_url.startswith(_VALID_SITE_PREFIXES):
        raise HTTPException(422, "invalid GSC site URL format")

    conn = await gsc_repo.get_connection(ctx.user_id)
    if conn is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Search Console is not connected")

    try:
        access_token = await gsc_sync.ensure_fresh_access_token(conn)
        sites = await gsc_service.list_sites(access_token=access_token)
    except GscDisabled as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except GscApiError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e

    authorized = {s.get("siteUrl") for s in sites}
    if body.site_url not in authorized:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "you do not have access to this site in Google Search Console",
        )

    updated = await gsc_repo.set_site(ctx.user_id, site_url=body.site_url)
    return StatusResponse(connected=True, site_url=updated.site_url if updated else body.site_url)


@router.delete("/connection", response_model=StatusResponse)
async def delete_connection(ctx: AuthCtx = CurrentUser) -> StatusResponse:
    await gsc_repo.delete_connection(ctx.user_id)
    return StatusResponse(connected=False)


# --------------------------------------------------------------------------- rankings / queries / gaps

class RankingItem(BaseModel):
    query: str
    clicks: int
    impressions: int
    ctr: float
    position: float
    prior_position: float | None = None
    # prior_position - position: positive means the query's average rank
    # improved (moved to a lower/better position number) vs. the prior
    # window; None when there's no prior-period data to compare against.
    position_delta: float | None = None


class RankingsResponse(BaseModel):
    site_url: str
    start: date
    end: date
    items: list[RankingItem]


@router.get("/rankings", response_model=RankingsResponse)
async def rankings(
    days: int = Query(default=28, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=500),
    ctx: AuthCtx = CurrentUser,
) -> RankingsResponse:
    conn = await gsc_repo.get_connection(ctx.user_id)
    site_url = conn.site_url if conn else ""

    end = date.today()
    start = end - timedelta(days=days - 1)
    prior_end = start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=days - 1)

    current = await gsc_repo.top_queries(ctx.user_id, start=start, end=end, limit=limit)
    prior = await gsc_repo.positions_for_queries(
        ctx.user_id, [r["query"] for r in current], start=prior_start, end=prior_end
    )

    items = []
    for row in current:
        prior_position = prior.get(row["query"])
        delta = float(prior_position - row["position"]) if prior_position is not None else None
        items.append(
            RankingItem(
                query=row["query"],
                clicks=row["clicks"],
                impressions=row["impressions"],
                ctr=float(row["ctr"]),
                position=float(row["position"]),
                prior_position=float(prior_position) if prior_position is not None else None,
                position_delta=delta,
            )
        )
    return RankingsResponse(site_url=site_url, start=start, end=end, items=items)


class QueryItem(BaseModel):
    query: str
    clicks: int
    impressions: int
    ctr: float
    position: float


class QueriesResponse(BaseModel):
    page: str
    items: list[QueryItem]


@router.get("/queries", response_model=QueriesResponse)
async def queries(
    page: str = Query(...),
    days: int = Query(default=28, ge=1, le=365),
    ctx: AuthCtx = CurrentUser,
) -> QueriesResponse:
    end = date.today()
    start = end - timedelta(days=days - 1)
    rows = await gsc_repo.queries_for_page(ctx.user_id, page=page, start=start, end=end)
    return QueriesResponse(
        page=page,
        items=[
            QueryItem(
                query=r["query"], clicks=r["clicks"], impressions=r["impressions"],
                ctr=float(r["ctr"]), position=float(r["position"]),
            )
            for r in rows
        ],
    )


class GapItem(BaseModel):
    query: str
    page: str
    clicks: int
    impressions: int
    position: float


class GapsResponse(BaseModel):
    items: list[GapItem]


# Queries ranking worse than this average position are treated as "not
# really ranking" for gap-finding purposes.
_GAP_MIN_POSITION = 20.0
_GAP_MIN_IMPRESSIONS = 20


@router.get("/gaps", response_model=GapsResponse)
async def gaps(
    days: int = Query(default=90, ge=1, le=365),
    ctx: AuthCtx = CurrentUser,
) -> GapsResponse:
    end = date.today()
    start = end - timedelta(days=days - 1)
    candidates = await gsc_repo.gap_candidates(
        ctx.user_id, start=start, end=end,
        min_impressions=_GAP_MIN_IMPRESSIONS, min_position=_GAP_MIN_POSITION,
    )
    terms = await gsc_repo.article_terms(ctx.user_id)

    items = [
        GapItem(
            query=c["query"], page=c["page"], clicks=c["clicks"],
            impressions=c["impressions"], position=float(c["position"]),
        )
        for c in candidates
        if not _matches_article(c["query"], terms)
    ]
    return GapsResponse(items=items)


def _matches_article(query: str, terms: list[tuple[str, str]]) -> bool:
    """True if some existing article already targets *query* — via an exact
    focus_keyword match or the query appearing in the article's title.
    Anything that doesn't match is a genuine content gap (no article covers
    it yet)."""
    q = query.strip().lower()
    if not q:
        return False
    for title, focus_keyword in terms:
        if focus_keyword and focus_keyword.strip().lower() == q:
            return True
        if title and q in title.strip().lower():
            return True
    return False
