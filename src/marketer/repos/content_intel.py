"""Content intelligence repo — topic clusters, corpus audits, and
cannibalization findings (migration 0021). Owned by Team Content-Intel.

Three independent record types, one module because they share no state
but do share a caller (services/content_intel.py) and an owner:

- content_clusters / content_cluster_items: a pillar + spoke plan built by
  one metered LLM call (see services.content_intel.plan_cluster), promoted
  spoke-by-spoke into the press topic_proposals queue.
- article_audits: point-in-time scoring snapshots (services.content_intel.
  audit_corpus writes one row per article per run; `latest_audits` collapses
  to the newest per article).
- cannibalization_findings: pairwise title/keyword similarity hits
  (services.content_intel.detect_cannibalization), upserted per user+pair so
  a human's `resolution` note survives a re-scan.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from ..db import get_pool

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ContentCluster(BaseModel):
    id: UUID
    user_id: str
    niche_id: UUID
    title: str
    pillar_keyword: str
    description: str
    created_at: datetime


class ContentClusterItem(BaseModel):
    id: UUID
    cluster_id: UUID
    article_id: UUID | None = None
    proposed_title: str
    focus_keyword: str
    status: str  # 'proposed' | 'covered'


class ClusterWithItems(ContentCluster):
    items: list[ContentClusterItem] = Field(default_factory=list)


class ClusterItemWithNiche(ContentClusterItem):
    """An item plus the niche_id of its parent cluster — what the promote
    route needs to create a topic proposal without a second round trip."""

    niche_id: UUID


class ArticleAudit(BaseModel):
    id: UUID
    user_id: str
    article_id: UUID
    score: float
    findings: list[dict]
    created_at: datetime


class CannibalizationFinding(BaseModel):
    id: UUID
    user_id: str
    article_a: UUID
    article_b: UUID
    keyword: str
    similarity: float
    resolution: str
    created_at: datetime


# ---------------------------------------------------------------------------
# content_clusters / content_cluster_items
# ---------------------------------------------------------------------------

_CLUSTER_COLS = "id, user_id, niche_id, title, pillar_keyword, description, created_at"
_ITEM_COLS = "id, cluster_id, article_id, proposed_title, focus_keyword, status"


async def create_cluster(
    *,
    user_id: str,
    niche_id: UUID,
    title: str,
    pillar_keyword: str = "",
    description: str = "",
) -> ContentCluster:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into content_clusters (user_id, niche_id, title, pillar_keyword, description)
        values ($1, $2, $3, $4, $5)
        returning {_CLUSTER_COLS}
        """,
        user_id, niche_id, title, pillar_keyword, description,
    )
    return ContentCluster(**dict(row))


async def add_item(
    *,
    cluster_id: UUID,
    proposed_title: str,
    focus_keyword: str = "",
    article_id: UUID | None = None,
    status: str = "proposed",
) -> ContentClusterItem:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into content_cluster_items
            (cluster_id, article_id, proposed_title, focus_keyword, status)
        values ($1, $2, $3, $4, $5)
        returning {_ITEM_COLS}
        """,
        cluster_id, article_id, proposed_title, focus_keyword, status,
    )
    return ContentClusterItem(**dict(row))


async def list_clusters(user_id: str, *, limit: int = 100) -> list[ContentCluster]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_CLUSTER_COLS} from content_clusters
         where user_id = $1
         order by created_at desc
         limit $2
        """,
        user_id, limit,
    )
    return [ContentCluster(**dict(r)) for r in rows]


async def get_cluster(cluster_id: UUID, *, user_id: str) -> ContentCluster | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_CLUSTER_COLS} from content_clusters where id = $1 and user_id = $2",
        cluster_id, user_id,
    )
    return ContentCluster(**dict(row)) if row else None


async def list_items(cluster_id: UUID) -> list[ContentClusterItem]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"select {_ITEM_COLS} from content_cluster_items where cluster_id = $1 order by proposed_title",
        cluster_id,
    )
    return [ContentClusterItem(**dict(r)) for r in rows]


async def delete_cluster(cluster_id: UUID, *, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "delete from content_clusters where id = $1 and user_id = $2",
        cluster_id, user_id,
    )
    return result.split()[-1] != "0"


async def get_item_with_niche(
    cluster_id: UUID, item_id: UUID, *, user_id: str
) -> ClusterItemWithNiche | None:
    """Ownership-scoped item lookup (via the parent cluster's user_id) that
    also surfaces the cluster's niche_id, so the promote route can create a
    topic proposal without a second query."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        select i.id, i.cluster_id, i.article_id, i.proposed_title,
               i.focus_keyword, i.status, c.niche_id
          from content_cluster_items i
          join content_clusters c on c.id = i.cluster_id
         where i.id = $1 and i.cluster_id = $2 and c.user_id = $3
        """,
        item_id, cluster_id, user_id,
    )
    return ClusterItemWithNiche(**dict(row)) if row else None


async def mark_item_covered(
    item_id: UUID, *, article_id: UUID | None = None
) -> ContentClusterItem | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        update content_cluster_items
           set status = 'covered', article_id = coalesce($2, article_id)
         where id = $1
        returning {_ITEM_COLS}
        """,
        item_id, article_id,
    )
    return ContentClusterItem(**dict(row)) if row else None


# ---------------------------------------------------------------------------
# article_audits
# ---------------------------------------------------------------------------

_AUDIT_COLS = "id, user_id, article_id, score, findings, created_at"


def _audit_row_to_model(row) -> ArticleAudit:
    import json

    d = dict(row)
    if isinstance(d.get("findings"), str):
        d["findings"] = json.loads(d["findings"])
    return ArticleAudit(**d)


async def save_audit(
    *, user_id: str, article_id: UUID, score: float, findings: list[dict]
) -> ArticleAudit:
    import json

    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into article_audits (user_id, article_id, score, findings)
        values ($1, $2, $3, $4::jsonb)
        returning {_AUDIT_COLS}
        """,
        user_id, article_id, score, json.dumps(findings),
    )
    return _audit_row_to_model(row)


async def latest_audits(user_id: str, *, limit: int = 500) -> list[ArticleAudit]:
    """The newest article_audits row per article_id, newest scored first."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select distinct on (article_id) {_AUDIT_COLS}
          from article_audits
         where user_id = $1
         order by article_id, created_at desc
        """,
        user_id,
    )
    out = [_audit_row_to_model(r) for r in rows]
    out.sort(key=lambda a: a.created_at, reverse=True)
    return out[:limit]


# ---------------------------------------------------------------------------
# cannibalization_findings
# ---------------------------------------------------------------------------

_FINDING_COLS = "id, user_id, article_a, article_b, keyword, similarity, resolution, created_at"


async def upsert_finding(
    *,
    user_id: str,
    article_a: UUID,
    article_b: UUID,
    keyword: str,
    similarity: float,
) -> CannibalizationFinding:
    """Insert a fresh finding, or refresh keyword/similarity on a re-scan.
    `resolution` is intentionally left untouched by the upsert so an
    operator's note (or a future resolution-editing endpoint) survives
    repeated scans."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into cannibalization_findings
            (user_id, article_a, article_b, keyword, similarity)
        values ($1, $2, $3, $4, $5)
        on conflict (user_id, article_a, article_b)
        do update set keyword = excluded.keyword, similarity = excluded.similarity
        returning {_FINDING_COLS}
        """,
        user_id, article_a, article_b, keyword, similarity,
    )
    return CannibalizationFinding(**dict(row))


async def list_findings(user_id: str, *, limit: int = 500) -> list[CannibalizationFinding]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_FINDING_COLS} from cannibalization_findings
         where user_id = $1
         order by similarity desc, created_at desc
         limit $2
        """,
        user_id, limit,
    )
    return [CannibalizationFinding(**dict(r)) for r in rows]
