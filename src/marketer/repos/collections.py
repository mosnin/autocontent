"""Article collections — user-named groupings of articles.

The source CMS calls these "blog groups" and makes them mandatory (every
post belongs to exactly one folder). Here they are optional and
many-to-many, because this product already has a mandatory one-to-many
grouping — the niche — and it means something else: a niche is the channel
configuration that *drives generation* (posting windows, spend cap, voice,
creative brief). A collection carries no generation settings and putting an
article into two of them must not change how it was written.

Membership lives in a junction table so the `articles` row (owned by the
pipeline) is untouched by this feature.
"""
from __future__ import annotations

from uuid import UUID

import asyncpg

from ..cms import slugs
from ..cms.schemas import Collection
from ..db import get_pool

_COLS = "id, user_id, name, slug, description, created_at, updated_at"


class CollectionSlugTaken(Exception):
    def __init__(self, slug: str) -> None:
        super().__init__(f"collection slug {slug!r} is already in use")
        self.slug = slug


def _to_collection(row, *, article_count: int = 0) -> Collection:
    d = dict(row)
    d["article_count"] = int(d.pop("article_count", article_count) or 0)
    return Collection.model_validate(d)


async def _free_slug(conn, user_id: str, base: str, *, exclude: UUID | None) -> str:
    """Resolve a collection slug against the user's existing collections.

    Unlike article slugs, collection slugs are auto-disambiguated rather
    than 409'd: a collection name is a label the user retypes casually
    ("Guides") and its URL is an index page, not a piece of content anyone
    has linked to. The `unique (user_id, slug)` constraint is still the
    backstop for the race.
    """
    rows = await conn.fetch(
        "select slug from article_collections where user_id = $1 and ($2::uuid is null or id <> $2)",
        user_id, exclude,
    )
    return slugs.resolve(base, {r["slug"] for r in rows})


async def create(
    *, user_id: str, name: str, description: str = "", slug: str | None = None
) -> Collection:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        base = slugs.normalize(slug or name)
        resolved = await _free_slug(conn, user_id, base, exclude=None)
        try:
            row = await conn.fetchrow(
                f"""
                insert into article_collections (user_id, name, slug, description)
                values ($1, $2, $3, $4)
                returning {_COLS}
                """,
                user_id, name, resolved, description,
            )
        except asyncpg.UniqueViolationError as exc:
            raise CollectionSlugTaken(resolved) from exc
    return _to_collection(row)


async def list_for_user(user_id: str, *, limit: int = 200) -> list[Collection]:
    """Collections with their membership counts (the sidebar's whole query)."""
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_COLS},
               (select count(*) from article_collection_items i
                 where i.collection_id = c.id) as article_count
          from article_collections c
         where user_id = $1
         order by created_at desc
         limit $2
        """,
        user_id, limit,
    )
    return [_to_collection(r) for r in rows]


async def get(collection_id: UUID, *, user_id: str) -> Collection | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        select {_COLS},
               (select count(*) from article_collection_items i
                 where i.collection_id = c.id) as article_count
          from article_collections c
         where id = $1 and user_id = $2
        """,
        collection_id, user_id,
    )
    return _to_collection(row) if row else None


async def update(
    collection_id: UUID,
    *,
    user_id: str,
    name: str | None = None,
    description: str | None = None,
    slug: str | None = None,
) -> Collection | None:
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        existing = await conn.fetchrow(
            f"select {_COLS} from article_collections where id = $1 and user_id = $2 for update",
            collection_id, user_id,
        )
        if existing is None:
            return None

        new_slug = existing["slug"]
        if slug is not None:
            new_slug = await _free_slug(
                conn, user_id, slugs.normalize(slug), exclude=collection_id
            )

        try:
            await conn.execute(
                """
                update article_collections
                   set name = $2, description = $3, slug = $4
                 where id = $1
                """,
                collection_id,
                name if name is not None else existing["name"],
                description if description is not None else existing["description"],
                new_slug,
            )
        except asyncpg.UniqueViolationError as exc:
            raise CollectionSlugTaken(new_slug) from exc
    return await get(collection_id, user_id=user_id)


async def delete(collection_id: UUID, *, user_id: str) -> bool:
    """Delete the collection. Memberships cascade; the ARTICLES DO NOT.

    Deliberately unlike the source CMS, where deleting a folder deletes
    every post inside it. A collection is a label, and losing generated
    articles (which cost real money to produce) because someone tidied up
    their sidebar is not a recoverable mistake.
    """
    pool = await get_pool()
    result = await pool.execute(
        "delete from article_collections where id = $1 and user_id = $2",
        collection_id, user_id,
    )
    return result.split()[-1] == "1"


async def assign(
    collection_id: UUID, *, user_id: str, article_ids: list[UUID]
) -> int:
    """Add articles to a collection. Returns the number newly added.

    Idempotent: re-assigning an article already in the collection is a
    no-op rather than an error, so a client retry cannot fail.

    BOTH sides of the relation are ownership-checked inside the statement,
    not just the articles: without the `exists` on the collection, a caller
    who guessed another user's collection id would file their own articles
    into a stranger's folder (the FK alone is happy to allow it). A foreign
    article id simply matches no row and is silently skipped, which also
    stops this endpoint from being an existence oracle for other users'
    article ids.
    """
    if not article_ids:
        return 0
    pool = await get_pool()
    result = await pool.execute(
        """
        insert into article_collection_items (collection_id, article_id, user_id)
        select $1, a.id, a.user_id
          from articles a
         where a.user_id = $2
           and a.id = any($3::uuid[])
           and exists (
               select 1 from article_collections c
                where c.id = $1 and c.user_id = $2
           )
        on conflict (collection_id, article_id) do nothing
        """,
        collection_id, user_id, article_ids,
    )
    return int(result.split()[-1])


async def unassign(
    collection_id: UUID, *, user_id: str, article_ids: list[UUID]
) -> int:
    if not article_ids:
        return 0
    pool = await get_pool()
    result = await pool.execute(
        """
        delete from article_collection_items
         where collection_id = $1 and user_id = $2 and article_id = any($3::uuid[])
        """,
        collection_id, user_id, article_ids,
    )
    return int(result.split()[-1])


async def article_ids(collection_id: UUID, *, user_id: str) -> list[UUID]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        select article_id from article_collection_items
         where collection_id = $1 and user_id = $2
         order by position, added_at
        """,
        collection_id, user_id,
    )
    return [r["article_id"] for r in rows]
