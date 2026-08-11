"""Article revision history + the CMS-side writes to `articles`.

Two things live in one module on purpose. Capturing a revision and mutating
the article are not separable operations: "capture the prior version, then
write the new one" has to happen in one transaction under one row lock, or a
crash between them loses the old content and two concurrent edits interleave
into a lost update. Splitting them across modules would invite a caller to
do half of it.

Append-only, like ``repos.admin_audit``: this module offers insert and
select over ``article_revisions`` and no update or delete. Restoring an old
revision writes a NEW revision recording the state it replaced.

The pipeline's own row access stays in ``repos.articles``; nothing here is
on the generation path.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from uuid import UUID

import asyncpg

from ..cms import publish as publish_rules
from ..cms import revisions as revision_rules
from ..cms import slugs
from ..cms.schemas import (
    ArticleEdit,
    CmsArticle,
    PublicationState,
    Revision,
    RevisionSummary,
)
from ..db import get_pool

# Article columns the CMS reads. Deliberately narrower than repos.articles'
# _COLS: the CMS has no business with hero images, JSON-LD or link
# suggestions, and not selecting them keeps the edit path cheap.
_ARTICLE_COLS = (
    "id, user_id, niche_id, status::text as status, publication_state, "
    "title, slug, meta_description, article_markdown, word_count, "
    "published_at, scheduled_at, created_at, updated_at"
)

_REVISION_SUMMARY_COLS = (
    "id, article_id, revision_number, changed_fields, summary, source, "
    "restored_from_revision_id, created_at"
)
_REVISION_FULL_COLS = (
    f"{_REVISION_SUMMARY_COLS}, title, slug, meta_description, article_markdown"
)

#: How many times a publish retries after losing a slug race. Each retry
#: re-reads the taken set, so the loser of a race picks the next candidate.
#: Three is plenty: it would take three simultaneous publishes of the same
#: title to exhaust it.
_SLUG_RACE_ATTEMPTS = 3


class SlugTaken(Exception):
    """The requested slug already backs another article's public URL."""

    def __init__(self, slug: str) -> None:
        super().__init__(f"slug {slug!r} is already in use")
        self.slug = slug


class InvalidSlug(Exception):
    """The caller's slug normalizes to nothing usable in a URL."""


class RevisionNotFound(Exception):
    def __init__(self, revision_id: UUID) -> None:
        super().__init__(f"revision {revision_id} not found")
        self.revision_id = revision_id


class ArticleVanished(RuntimeError):
    """A locked article row disappeared mid-transaction — impossible under
    the row lock, so this is a bug rather than a user-facing condition."""


def _to_article(row) -> CmsArticle:
    return CmsArticle.model_validate(dict(row))


def _to_revision_summary(row) -> RevisionSummary:
    d = dict(row)
    d["changed_fields"] = list(d.get("changed_fields") or [])
    return RevisionSummary.model_validate(d)


def _to_revision(row) -> Revision:
    d = dict(row)
    d["changed_fields"] = list(d.get("changed_fields") or [])
    return Revision.model_validate(d)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def get_article(article_id: UUID, *, user_id: str) -> CmsArticle | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        f"select {_ARTICLE_COLS} from articles where id = $1 and user_id = $2",
        article_id, user_id,
    )
    return _to_article(row) if row else None


async def get_article_by_slug(slug: str, *, user_id: str) -> CmsArticle | None:
    """Resolve a public slug to the article serving it.

    Scoped to rows that are actually live: a draft that happens to hold the
    slug must not answer a public URL. The unique index means at most one
    row can match.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        select {_ARTICLE_COLS} from articles
         where user_id = $1 and slug = $2 and publication_state = 'published'
         limit 1
        """,
        user_id, slug,
    )
    return _to_article(row) if row else None


async def list_revisions(
    article_id: UUID, *, user_id: str, limit: int = 100
) -> list[RevisionSummary]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"""
        select {_REVISION_SUMMARY_COLS} from article_revisions
         where article_id = $1 and user_id = $2
         order by revision_number desc
         limit $3
        """,
        article_id, user_id, limit,
    )
    return [_to_revision_summary(r) for r in rows]


async def get_revision(
    revision_id: UUID, *, article_id: UUID, user_id: str
) -> Revision | None:
    """Both article_id and user_id are predicates, not just user_id: a
    revision id from another article of the same user must not resolve
    under this article's URL."""
    pool = await get_pool()
    row = await pool.fetchrow(
        f"""
        select {_REVISION_FULL_COLS} from article_revisions
         where id = $1 and article_id = $2 and user_id = $3
        """,
        revision_id, article_id, user_id,
    )
    return _to_revision(row) if row else None


# ---------------------------------------------------------------------------
# Internal helpers — all take an explicit connection; callers hold the txn
# ---------------------------------------------------------------------------


async def _locked_article(conn, article_id: UUID, user_id: str) -> CmsArticle | None:
    """Read the article under a row lock.

    `for update` is what serializes concurrent edits of one article: without
    it two PATCHes both read version N, both capture N as "the prior
    version", and the second silently discards the first's changes.
    """
    row = await conn.fetchrow(
        f"select {_ARTICLE_COLS} from articles where id = $1 and user_id = $2 for update",
        article_id, user_id,
    )
    return _to_article(row) if row else None


async def _reread(conn, article_id: UUID, user_id: str) -> CmsArticle:
    article = await _locked_article(conn, article_id, user_id)
    if article is None:
        raise ArticleVanished(str(article_id))
    return article


async def _next_revision_number(conn, article_id: UUID) -> int:
    """Safe because the caller holds the article row lock, so revision
    numbers for one article are handed out one at a time."""
    n = await conn.fetchval(
        "select coalesce(max(revision_number), 0) from article_revisions where article_id = $1",
        article_id,
    )
    return int(n or 0) + 1


async def _capture(
    conn,
    *,
    article: CmsArticle,
    changed: list[str],
    source: str,
    summary: str,
    restored_from: UUID | None = None,
) -> RevisionSummary:
    """Append one revision holding the article's state BEFORE this write."""
    before = revision_rules.snapshot(article.model_dump())
    number = await _next_revision_number(conn, article.id)
    row = await conn.fetchrow(
        f"""
        insert into article_revisions
            (article_id, user_id, revision_number, title, slug, meta_description,
             article_markdown, changed_fields, summary, source, restored_from_revision_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning {_REVISION_SUMMARY_COLS}
        """,
        article.id,
        article.user_id,
        number,
        before.get("title"),
        before.get("slug"),
        before.get("meta_description"),
        before.get("article_markdown"),
        changed,
        summary,
        source,
        restored_from,
    )
    return _to_revision_summary(row)


async def _write_editable(conn, article_id: UUID, after: dict) -> None:
    """Apply the merged editable surface to the article row.

    word_count is recomputed with the pipeline's own definition so a
    hand-edited article stays comparable with a generated one instead of
    reporting the length it had before someone rewrote it.
    """
    try:
        await conn.execute(
            """
            update articles
               set title = $2, slug = $3, meta_description = $4,
                   article_markdown = $5, word_count = $6
             where id = $1
            """,
            article_id,
            after.get("title"),
            after.get("slug"),
            after.get("meta_description"),
            after.get("article_markdown"),
            revision_rules.word_count(after.get("article_markdown")),
        )
    except asyncpg.UniqueViolationError as exc:
        # The partial unique index caught a slug race the SELECT could not
        # see (another request published onto this slug between the two).
        raise SlugTaken(after.get("slug") or "") from exc


async def _public_slugs(conn, user_id: str, *, exclude: UUID) -> set[str]:
    """Slugs of this user's articles that are (or have ever been) public.

    Mirrors the predicate of `articles_user_public_slug_uniq` exactly — a
    slug that has ever been live stays retired to the article that served
    it, so an old inbound link can never be re-pointed at other content.
    """
    rows = await conn.fetch(
        """
        select slug from articles
         where user_id = $1 and slug is not null and id <> $2
           and (publication_state in ('scheduled', 'published')
                or published_at is not null)
        """,
        user_id, exclude,
    )
    return {r["slug"] for r in rows}


async def _resolve_public_slug(conn, article: CmsArticle) -> str:
    """Pick the slug this article will serve on.

    An article that has ever been published keeps its slug verbatim (it is
    frozen and already reserved to this row). A first-time publish resolves
    the machine-generated slug against the user's taken set — here the
    silent `-2` suffix is right, because the input is LLM output rather than
    a human's deliberate choice.
    """
    if article.published_at is not None and article.slug:
        return article.slug
    base = slugs.base_of(slugs.normalize(article.slug or article.title))
    taken = await _public_slugs(conn, article.user_id, exclude=article.id)
    return slugs.resolve(base, taken)


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


async def apply_edit(
    article_id: UUID, *, user_id: str, edit: ArticleEdit
) -> tuple[CmsArticle, RevisionSummary | None] | None:
    """Edit an article, capturing the prior version first.

    Returns (updated article, captured revision) — the revision is None when
    the edit was a no-op, because an edit that changed nothing must not burn
    a revision number and pad the history with noise. Returns None if the
    article doesn't exist or isn't the caller's.

    Raises `InvalidSlug` / `SlugTaken` on slug problems and
    `publish.PublishGuard` when the edit would move a frozen slug.
    """
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        article = await _locked_article(conn, article_id, user_id)
        if article is None:
            return None

        before = revision_rules.snapshot(article.model_dump())
        after = revision_rules.apply_edit(article.model_dump(), edit)

        if "slug" in edit.changes():
            # A caller-supplied slug is normalized, never taken verbatim: it
            # comes from a text box and lands in a URL.
            desired = slugs.normalize(after["slug"], fallback="")
            if not desired:
                raise InvalidSlug(str(after["slug"]))
            publish_rules.guard_slug_change(article, desired)
            if desired != (article.slug or "") and desired in await _public_slugs(
                conn, user_id, exclude=article_id
            ):
                # A hand-typed slug is NOT auto-disambiguated the way a
                # machine-generated one is at publish time: silently turning
                # the user's "pricing" into "pricing-2" hides the collision
                # from the person who deliberately chose the word.
                raise SlugTaken(desired)
            after["slug"] = desired

        changed = revision_rules.changed_fields(before, after)
        if not changed:
            return article, None

        revision = await _capture(
            conn,
            article=article,
            changed=changed,
            source="edit",
            summary=revision_rules.summarize(changed, before, after),
        )
        await _write_editable(conn, article_id, after)
        return await _reread(conn, article_id, user_id), revision


async def restore(
    article_id: UUID, *, user_id: str, revision_id: UUID
) -> tuple[CmsArticle, RevisionSummary | None] | None:
    """Restore a revision's content as a NEW revision.

    History is never rewound: the state being replaced is captured first
    (source='restore'), so "restore v2, dislike it, restore v5" is fully
    reversible and every step stays in the trail.
    """
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        article = await _locked_article(conn, article_id, user_id)
        if article is None:
            return None

        row = await conn.fetchrow(
            f"""
            select {_REVISION_FULL_COLS} from article_revisions
             where id = $1 and article_id = $2 and user_id = $3
            """,
            revision_id, article_id, user_id,
        )
        if row is None:
            raise RevisionNotFound(revision_id)
        target = _to_revision(row)

        before = revision_rules.snapshot(article.model_dump())
        after = dict(before)
        after.update(revision_rules.restore_payload(target.model_dump()))

        if after.get("slug") != before.get("slug"):
            # Restoring an old body must not silently move a live URL, so a
            # frozen slug wins over the snapshot's.
            try:
                publish_rules.guard_slug_change(article, after.get("slug") or "")
            except publish_rules.PublishGuard:
                after["slug"] = before.get("slug")

        changed = revision_rules.changed_fields(before, after)
        if not changed:
            return article, None

        revision = await _capture(
            conn,
            article=article,
            changed=changed,
            source="restore",
            summary=revision_rules.restore_summary(target.revision_number, changed),
            restored_from=target.id,
        )
        await _write_editable(conn, article_id, after)
        return await _reread(conn, article_id, user_id), revision


async def set_publication(
    article_id: UUID,
    *,
    user_id: str,
    planner: Callable[[CmsArticle], publish_rules.Transition],
) -> CmsArticle | None:
    """Apply a publication transition computed under the article's row lock.

    The planner (a pure function from `cms.publish`) is called *inside* the
    transaction on the freshly-locked row rather than on a copy the route
    read a moment earlier. Otherwise the guards would be evaluated against
    stale state — e.g. two publishes racing, both seeing 'draft', both
    stamping published_at.
    """
    pool = await get_pool()
    last_error: Exception | None = None

    for _ in range(_SLUG_RACE_ATTEMPTS):
        try:
            async with pool.acquire() as conn, conn.transaction():
                article = await _locked_article(conn, article_id, user_id)
                if article is None:
                    return None

                transition = planner(article)
                if not transition.changed:
                    return article

                slug = article.slug
                if transition.state is not PublicationState.draft:
                    slug = await _resolve_public_slug(conn, article)

                row = await conn.fetchrow(
                    f"""
                    update articles
                       set publication_state = $2,
                           published_at = $3,
                           scheduled_at = $4,
                           slug = $5
                     where id = $1
                    returning {_ARTICLE_COLS}
                    """,
                    article_id,
                    transition.state.value,
                    transition.published_at,
                    transition.scheduled_at,
                    slug,
                )
                return _to_article(row)
        except asyncpg.UniqueViolationError as exc:
            # Someone else took our candidate between the SELECT and the
            # UPDATE. Retry: the next pass sees their row in the taken set
            # and picks the following candidate.
            last_error = exc
            continue

    raise SlugTaken("") from last_error


async def publish_due(*, now: datetime | None = None) -> int:
    """Flip scheduled articles whose time has come to published.

    Idempotent by construction (the predicate excludes rows already
    published), so a scheduler that fires twice, or two schedulers racing,
    publish each article exactly once and never re-stamp published_at.

    NOT yet wired to a periodic tick — the scheduling package is owned
    elsewhere; see the handover notes. Until it is, `POST /publish` with no
    scheduled_at is the live path.
    """
    pool = await get_pool()
    result = await pool.execute(
        """
        update articles
           set publication_state = 'published',
               published_at = coalesce(published_at, scheduled_at, now()),
               scheduled_at = null
         where publication_state = 'scheduled'
           and scheduled_at <= coalesce($1::timestamptz, now())
        """,
        now,
    )
    return int(result.split()[-1])
