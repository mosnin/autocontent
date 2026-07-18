"""Content intelligence — clusters, corpus audit, cannibalization (Team
Content-Intel).

Registered in main.py at /api/v1/intelligence.

Cluster planning is the only endpoint here that spends money: it makes one
metered LLM call (services.content_intel.plan_cluster) under the same
SpendContext contract as every other agent call in the pipeline, and
SpendCapExceeded propagates to a 402 exactly like POST /press/topics/generate
does (see routes/press.py:generate_topics). Audit and cannibalization scans
are pure data operations — no LLM, no spend.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from marketer.repos import content_intel as repo
from marketer.repos import niches as niches_repo
from marketer.repos import topic_proposals as proposals_repo
from marketer.repos.topic_proposals import TopicProposal

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


# ---------------------------------------------------------------------------
# Clusters
# ---------------------------------------------------------------------------


class ClusterPlanBody(BaseModel):
    niche_id: UUID
    pillar_keyword: str


@router.post(
    "/clusters/plan",
    response_model=repo.ClusterWithItems,
    status_code=status.HTTP_201_CREATED,
)
async def plan_cluster(
    body: ClusterPlanBody, ctx: AuthCtx = CurrentUser
) -> repo.ClusterWithItems:
    """Build a pillar + spoke topic cluster for a niche. One metered LLM
    call, charged to the niche's daily cap (same spend contract as every
    other article LLM call)."""
    from marketer.repos import articles as articles_repo
    from marketer.repos import brand_kit as brand_kit_repo
    from marketer.repos.spend import SpendCapExceeded
    from marketer.services import content_intel as service
    from marketer.services.spend_context import default_context

    niche = await niches_repo.get(body.niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    brand = await brand_kit_repo.get(ctx.user_id)
    corpus_titles = await articles_repo.recent_titles_for_niche(
        body.niche_id, user_id=ctx.user_id
    )
    spend = await default_context(
        user_id=ctx.user_id, niche_id=body.niche_id, job_id=None,
        cap_usd=niche.daily_spend_cap_usd,
    )
    try:
        plan = await service.plan_cluster(
            niche, brand, corpus_titles, body.pillar_keyword, spend=spend
        )
    except SpendCapExceeded as exc:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "cluster planning failed") from exc

    cluster = await repo.create_cluster(
        user_id=ctx.user_id, niche_id=body.niche_id, title=plan.pillar_title,
        pillar_keyword=body.pillar_keyword,
        description=f"Cluster around '{body.pillar_keyword}'",
    )
    items = [
        await repo.add_item(
            cluster_id=cluster.id, proposed_title=spoke.title,
            focus_keyword=spoke.focus_keyword,
            status="covered" if spoke.covered else "proposed",
        )
        for spoke in plan.spokes
    ]
    return repo.ClusterWithItems(**cluster.model_dump(), items=items)


@router.get("/clusters", response_model=list[repo.ContentCluster])
async def list_clusters(ctx: AuthCtx = CurrentUser) -> list[repo.ContentCluster]:
    return await repo.list_clusters(ctx.user_id)


@router.get("/clusters/{cluster_id}", response_model=repo.ClusterWithItems)
async def get_cluster(cluster_id: UUID, ctx: AuthCtx = CurrentUser) -> repo.ClusterWithItems:
    cluster = await repo.get_cluster(cluster_id, user_id=ctx.user_id)
    if cluster is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="cluster not found")
    items = await repo.list_items(cluster_id)
    return repo.ClusterWithItems(**cluster.model_dump(), items=items)


@router.delete("/clusters/{cluster_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_cluster(cluster_id: UUID, ctx: AuthCtx = CurrentUser) -> None:
    deleted = await repo.delete_cluster(cluster_id, user_id=ctx.user_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="cluster not found")


@router.post(
    "/clusters/{cluster_id}/items/{item_id}/promote",
    response_model=TopicProposal,
    status_code=status.HTTP_201_CREATED,
)
async def promote_item(
    cluster_id: UUID, item_id: UUID, ctx: AuthCtx = CurrentUser
) -> TopicProposal:
    """Promote a proposed spoke into the press approval queue
    (topic_proposals) and mark the cluster item covered."""
    item = await repo.get_item_with_niche(cluster_id, item_id, user_id=ctx.user_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="cluster item not found")
    if item.status == "covered":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="item is already covered")

    proposal = await proposals_repo.create(
        user_id=ctx.user_id, niche_id=item.niche_id, title=item.proposed_title,
        focus_keyword=item.focus_keyword,
        rationale=f"promoted from content cluster {cluster_id}",
        score=0.5,
    )
    await repo.mark_item_covered(item_id)
    return proposal


# ---------------------------------------------------------------------------
# Corpus audit — no LLM, scored from stored data
# ---------------------------------------------------------------------------


class AuditRunSummary(BaseModel):
    audited: int
    average_score: float
    low_score_count: int


@router.post("/audit/run", response_model=AuditRunSummary)
async def run_audit(ctx: AuthCtx = CurrentUser) -> AuditRunSummary:
    from marketer.services import content_intel as service

    audits = await service.audit_corpus(ctx.user_id)
    if not audits:
        return AuditRunSummary(audited=0, average_score=0.0, low_score_count=0)
    avg = sum(a.score for a in audits) / len(audits)
    low = sum(1 for a in audits if a.score < service.LOW_SCORE_THRESHOLD)
    return AuditRunSummary(
        audited=len(audits), average_score=round(avg, 2), low_score_count=low
    )


@router.get("/audit", response_model=list[repo.ArticleAudit])
async def list_audits(ctx: AuthCtx = CurrentUser) -> list[repo.ArticleAudit]:
    """Latest article_audits row per article (not the full history)."""
    return await repo.latest_audits(ctx.user_id)


# ---------------------------------------------------------------------------
# Cannibalization — no LLM, difflib title/keyword similarity
# ---------------------------------------------------------------------------


@router.post("/cannibalization/scan", response_model=list[repo.CannibalizationFinding])
async def scan_cannibalization(ctx: AuthCtx = CurrentUser) -> list[repo.CannibalizationFinding]:
    from marketer.services import content_intel as service

    return await service.detect_cannibalization(ctx.user_id)


@router.get("/cannibalization", response_model=list[repo.CannibalizationFinding])
async def list_cannibalization(ctx: AuthCtx = CurrentUser) -> list[repo.CannibalizationFinding]:
    return await repo.list_findings(ctx.user_id)
