"""Keyword research — harvester, difficulty scoring, SERP toolbox (Team Keywords).

Registered in main.py at /api/v1/keywords.

Lifecycle: candidate -> tracked | dismissed | promoted (migration 0020).
POST /harvest seeds candidates via one metered LLM call (same spend-context
contract as POST /press/topics/generate — see marketer.services.keyword_research
and marketer.repos.keywords). POST /{id}/score runs the Exa-backed difficulty
heuristic. POST /{id}/promote hands a candidate to the press planner's
topic_proposals approval queue (migration 0017, owned by Team Press) and
marks the candidate promoted.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from marketer.repos.keywords import KeywordCandidate

from ..auth import AuthCtx, CurrentUser

router = APIRouter()

_STATUSES = {"candidate", "tracked", "dismissed", "promoted"}


class HarvestBody(BaseModel):
    niche_id: UUID
    # Omit to use keyword_research.DEFAULT_HARVEST_N.
    n: int | None = Field(default=None, ge=1, le=50)


@router.post("/harvest", response_model=list[KeywordCandidate])
async def harvest(body: HarvestBody, ctx: AuthCtx = CurrentUser) -> list[KeywordCandidate]:
    """Harvest a batch of candidate keywords for a niche. One metered LLM
    call charged to the niche's daily cap, same spend-context contract as
    POST /press/topics/generate. Candidates that already exist for this
    (user, niche, keyword) are silently skipped (upsert-skip via the
    unique constraint in migration 0020) rather than erroring — the LLM is
    only asked to avoid duplicating the niche's existing keywords on a
    best-effort basis."""
    from marketer.repos import brand_kit as brand_kit_repo
    from marketer.repos import keywords as keywords_repo
    from marketer.repos import niches as niches_repo
    from marketer.repos.spend import SpendCapExceeded
    from marketer.services import keyword_research
    from marketer.services.spend_context import default_context

    niche = await niches_repo.get(body.niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    n = body.n or keyword_research.DEFAULT_HARVEST_N
    brand = await brand_kit_repo.get(ctx.user_id)
    existing = await keywords_repo.list_for_user(
        ctx.user_id, niche_id=body.niche_id, limit=500
    )
    existing_keywords = [c.keyword for c in existing]

    spend = await default_context(
        user_id=ctx.user_id, niche_id=body.niche_id, job_id=None,
        cap_usd=niche.daily_spend_cap_usd,
    )
    try:
        picks = await keyword_research.harvest(
            niche, brand, existing_keywords, n, spend=spend
        )
    except SpendCapExceeded as exc:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "keyword harvest failed") from exc

    created: list[KeywordCandidate] = []
    for pick in picks:
        row = await keywords_repo.create(
            user_id=ctx.user_id, niche_id=body.niche_id, keyword=pick.keyword,
            intent=pick.intent, rationale=pick.rationale,
        )
        if row is not None:
            created.append(row)
    return created


@router.get("", response_model=list[KeywordCandidate])
async def list_keywords(
    ctx: AuthCtx = CurrentUser,
    niche_id: UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[KeywordCandidate]:
    if status_filter is not None and status_filter not in _STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid status filter")

    from marketer.repos import keywords as keywords_repo

    return await keywords_repo.list_for_user(
        ctx.user_id, niche_id=niche_id, status=status_filter, limit=limit
    )


@router.post("/{candidate_id}/track", response_model=KeywordCandidate)
async def track_keyword(candidate_id: UUID, ctx: AuthCtx = CurrentUser) -> KeywordCandidate:
    from marketer.repos import keywords as keywords_repo

    row = await keywords_repo.set_status(
        candidate_id, user_id=ctx.user_id, status="tracked", from_statuses=("candidate",)
    )
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "candidate not found or not trackable"
        )
    return row


@router.post("/{candidate_id}/dismiss", response_model=KeywordCandidate)
async def dismiss_keyword(candidate_id: UUID, ctx: AuthCtx = CurrentUser) -> KeywordCandidate:
    from marketer.repos import keywords as keywords_repo

    row = await keywords_repo.set_status(
        candidate_id, user_id=ctx.user_id, status="dismissed",
        from_statuses=("candidate", "tracked"),
    )
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "candidate not found or not dismissable"
        )
    return row


@router.post("/{candidate_id}/score", response_model=KeywordCandidate)
async def score_keyword(candidate_id: UUID, ctx: AuthCtx = CurrentUser) -> KeywordCandidate:
    """Run the Exa-backed difficulty heuristic and persist the result.
    Difficulty is set to null (not a 4xx/5xx) when Exa isn't configured or
    the SERP fetch yields nothing — see
    keyword_research.score_difficulty."""
    from marketer.repos import keywords as keywords_repo
    from marketer.services import keyword_research

    candidate = await keywords_repo.get(candidate_id, user_id=ctx.user_id)
    if candidate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")

    result = await keyword_research.score_difficulty(candidate.keyword)
    difficulty = (
        Decimal(str(round(result.difficulty, 2))) if result.difficulty is not None else None
    )
    row = await keywords_repo.set_difficulty(
        candidate_id, user_id=ctx.user_id, difficulty=difficulty
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "candidate not found")
    return row


@router.post("/{candidate_id}/promote", response_model=KeywordCandidate)
async def promote_keyword(candidate_id: UUID, ctx: AuthCtx = CurrentUser) -> KeywordCandidate:
    """Promote a candidate into the press planner's approval queue
    (topic_proposals, status='pending') and mark the candidate promoted.
    The proposal's rationale carries over from the candidate's harvest
    rationale so the "why" survives the handoff. The status transition
    runs first (atomically guarded, same one-shot pattern as
    topic_proposals.decide) so an already-promoted or -dismissed candidate
    never spawns a duplicate proposal."""
    from marketer.repos import keywords as keywords_repo
    from marketer.repos import topic_proposals as proposals_repo

    row = await keywords_repo.set_status(
        candidate_id, user_id=ctx.user_id, status="promoted",
        from_statuses=("candidate", "tracked"),
    )
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "candidate not found or already promoted/dismissed",
        )

    await proposals_repo.create(
        user_id=ctx.user_id,
        niche_id=row.niche_id,
        title=row.keyword,
        focus_keyword=row.keyword,
        rationale=row.rationale,
    )
    return row
