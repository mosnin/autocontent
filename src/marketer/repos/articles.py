from __future__ import annotations

import json
from uuid import UUID

from ..articles.models import Article, ArticleStatus
from ..db import get_pool

_COLS = (
    "id, user_id, niche_id, status, topic, focus_keyword, title, slug, "
    "meta_description, keywords, article_markdown, schema_json, "
    "hero_image_path, hero_image_alt, quality, link_suggestions, "
    "word_count, error, created_at, updated_at"
)


def _row_to_model(row) -> Article:
    d = dict(row)
    for key in ("quality", "link_suggestions"):
        if isinstance(d.get(key), str):
            d[key] = json.loads(d[key])
    if d.get("quality") is None:
        d.pop("quality", None)
    d["schema_jsonld"] = d.pop("schema_json", None)
    d["keywords"] = list(d.get("keywords") or [])
    d["link_suggestions"] = d.get("link_suggestions") or []
    return Article.model_validate(d)


async def create(*, user_id: str, niche_id: UUID, topic: str = "") -> Article:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        insert into articles (user_id, niche_id, topic)
        values ($1, $2, $3)
        returning {_COLS}
        """,
        user_id, niche_id, topic,
    )
    return _row_to_model(row)


async def save(article: Article) -> None:
    """Persist the in-memory Article after each pipeline stage."""
    pool = await get_pool()
    await pool.execute(
        """
        update articles
           set status = $2,
               topic = $3,
               focus_keyword = $4,
               title = $5,
               slug = $6,
               meta_description = $7,
               keywords = $8,
               article_markdown = $9,
               schema_json = $10,
               hero_image_path = $11,
               hero_image_alt = $12,
               quality = $13::jsonb,
               link_suggestions = $14::jsonb,
               word_count = $15,
               error = $16
         where id = $1
        """,
        article.id,
        article.status.value,
        article.topic,
        article.focus_keyword,
        article.title,
        article.slug,
        article.meta_description,
        article.keywords,
        article.article_markdown,
        article.schema_jsonld,
        article.hero_image_path,
        article.hero_image_alt,
        article.quality.model_dump_json() if article.quality else None,
        json.dumps([s.model_dump() for s in article.link_suggestions]),
        article.word_count,
        article.error,
    )


async def get(article_id: UUID, *, user_id: str) -> Article | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_COLS} from articles where id = $1 and user_id = $2",
        article_id, user_id,
    )
    return _row_to_model(row) if row else None


async def list_for_user(
    user_id: str,
    *,
    status: ArticleStatus | None = None,
    niche_id: UUID | None = None,
    limit: int = 50,
) -> list[Article]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS} from articles
         where user_id = $1
           and ($2::article_status is null or status = $2)
           and ($3::uuid is null or niche_id = $3)
         order by created_at desc
         limit $4
        """,
        user_id,
        status.value if status is not None else None,
        niche_id,
        limit,
    )
    out: list[Article] = []
    for r in rows:
        try:
            out.append(_row_to_model(r))
        except Exception:  # noqa: BLE001 — one corrupt row must not 500 the list
            import logging

            logging.getLogger(__name__).exception("unparseable article row; skipping")
    return out


async def interlink_candidates(user_id: str, *, limit: int = 25) -> list[dict]:
    """Prior finished articles (title + slug) for internal-link suggestions."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select title, slug from articles
         where user_id = $1 and status = 'done'
           and title is not null and slug is not null
         order by created_at desc
         limit $2
        """,
        user_id, limit,
    )
    return [{"title": r["title"], "slug": r["slug"]} for r in rows]


async def recent_titles_for_niche(niche_id: UUID, *, user_id: str, limit: int = 25) -> list[str]:
    """Titles/topics of recent articles in the niche (topic dedup input)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select coalesce(title, topic) as t from articles
         where niche_id = $1 and user_id = $2 and status != 'failed'
         order by created_at desc
         limit $3
        """,
        niche_id, user_id, limit,
    )
    return [r["t"] for r in rows if r["t"]]


async def reap_stale(*, older_than_minutes: int = 120) -> int:
    """Fail articles stuck in a non-terminal status with no progress —
    same contract as jobs.reap_stale."""
    pool = await get_pool()
    result = await pool.execute(
        """
        update articles
           set status = 'failed',
               error = 'reaped: no progress (container died or timed out mid-run)'
         where status not in ('done', 'failed')
           and updated_at < now() - make_interval(mins => $1)
        """,
        older_than_minutes,
    )
    return int(result.split()[-1])


async def cost_usd(article_id: UUID, *, user_id: str):
    """Total ledger spend attributed to one article."""
    from decimal import Decimal

    pool = await get_pool()
    val = await pool.fetchval(
        """
        select coalesce(sum(cost_usd), 0) from spend_ledger
         where article_id = $1 and user_id = $2
        """,
        article_id, user_id,
    )
    return Decimal(val) if val is not None else Decimal(0)
