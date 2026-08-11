"""CMS endpoints — the editorial layer over generated articles.

`/api/v1/articles` is the *generation* surface: enqueue a pipeline run, poll
it, download the result. It is write-once by design. This router is what a
CMS needs afterwards:

- PATCH  /articles/{id}                          — hand-edit (captures a revision)
- GET    /articles/{id}/revisions                — history
- GET    /articles/{id}/revisions/{rid}          — one revision, full content
- POST   /articles/{id}/revisions/{rid}/restore  — restore AS A NEW revision
- POST   /articles/{id}/publish                  — publish now, or schedule
- POST   /articles/{id}/unpublish                — back to draft
- GET    /articles/by-slug/{slug}                — resolve a public URL
- GET/POST        /collections                   — list / create
- PATCH|DELETE    /collections/{id}              — rename / remove
- POST            /collections/{id}/articles     — assign articles
- POST            /bulk-topics                   — queue N pipeline runs (202)

Everything is user-scoped through `AuthCtx`; a miss or a foreign row is a
404 with no distinction between the two.

ROUTE ORDER MATTERS: `/articles/by-slug/{slug}` is declared before
`/articles/{article_id}` so a literal path segment is never swallowed by the
UUID-typed parameter route (which would 422 on "by-slug" rather than fall
through). `/collections` and `/bulk-topics` sit on a different first segment
than `/articles/{id}`, so they cannot be shadowed at all.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel

from marketer.cms import publish as publish_rules
from marketer.cms.schemas import (
    ArticleEdit,
    BulkTopics,
    BulkTopicsAccepted,
    CmsArticle,
    Collection,
    CollectionAssign,
    CollectionCreate,
    CollectionUpdate,
    PublishRequest,
    Revision,
    RevisionSummary,
)
from marketer.repos import article_revisions as revisions_repo
from marketer.repos import collections as collections_repo

from ..auth import AuthCtx, CurrentUser

router = APIRouter()


class EditResult(BaseModel):
    """The updated article plus the revision the edit captured.

    Returning the revision inline saves the editor a follow-up GET to show
    "saved — v4"; it is None when the PATCH changed nothing.
    """

    article: CmsArticle
    revision: RevisionSummary | None = None


def _guard_to_http(exc: publish_rules.PublishGuard) -> HTTPException:
    """Every publication guard is a 409: the request is well-formed, the
    article's state just doesn't allow it. The stable `code` goes in the
    detail so a client can branch without string-matching prose."""
    return HTTPException(
        status.HTTP_409_CONFLICT, detail={"code": exc.code, "message": exc.message}
    )


# ---------------------------------------------------------------------------
# Editing + revisions
# ---------------------------------------------------------------------------


@router.get("/articles/by-slug/{slug}", response_model=CmsArticle)
async def get_article_by_slug(slug: str, ctx: AuthCtx = CurrentUser) -> CmsArticle:
    """Resolve a published slug to its article — the read a public renderer
    performs for `/{slug}`. Only `published` rows answer here; a draft
    holding the slug 404s, so unpublishing really does take the page down."""
    article = await revisions_repo.get_article_by_slug(slug, user_id=ctx.user_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return article


@router.patch("/articles/{article_id}", response_model=EditResult)
async def edit_article(
    article_id: UUID, body: ArticleEdit, ctx: AuthCtx = CurrentUser
) -> EditResult:
    """Hand-edit an article. The prior version is captured as a revision in
    the same transaction, before the new content is written."""
    try:
        result = await revisions_repo.apply_edit(
            article_id, user_id=ctx.user_id, edit=body
        )
    except publish_rules.PublishGuard as exc:
        raise _guard_to_http(exc) from exc
    except revisions_repo.InvalidSlug as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="slug contains no URL-safe characters",
        ) from exc
    except revisions_repo.SlugTaken as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "slug_taken", "message": str(exc)},
        ) from exc

    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    article, revision = result
    return EditResult(article=article, revision=revision)


@router.get("/articles/{article_id}/revisions", response_model=list[RevisionSummary])
async def list_revisions(
    article_id: UUID,
    ctx: AuthCtx = CurrentUser,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[RevisionSummary]:
    # 404 on an unknown/foreign article rather than an empty list, so the
    # caller can tell "no history yet" from "not your article".
    if await revisions_repo.get_article(article_id, user_id=ctx.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await revisions_repo.list_revisions(
        article_id, user_id=ctx.user_id, limit=limit
    )


@router.get(
    "/articles/{article_id}/revisions/{revision_id}", response_model=Revision
)
async def get_revision(
    article_id: UUID, revision_id: UUID, ctx: AuthCtx = CurrentUser
) -> Revision:
    revision = await revisions_repo.get_revision(
        revision_id, article_id=article_id, user_id=ctx.user_id
    )
    if revision is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return revision


@router.post(
    "/articles/{article_id}/revisions/{revision_id}/restore",
    response_model=EditResult,
)
async def restore_revision(
    article_id: UUID, revision_id: UUID, ctx: AuthCtx = CurrentUser
) -> EditResult:
    """Restore a revision's content. Writes a NEW revision capturing what it
    replaced — history is never rewound or deleted."""
    try:
        result = await revisions_repo.restore(
            article_id, user_id=ctx.user_id, revision_id=revision_id
        )
    except revisions_repo.RevisionNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND) from exc
    except revisions_repo.SlugTaken as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "slug_taken", "message": str(exc)},
        ) from exc

    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    article, revision = result
    return EditResult(article=article, revision=revision)


# ---------------------------------------------------------------------------
# Publication
# ---------------------------------------------------------------------------


@router.post("/articles/{article_id}/publish", response_model=CmsArticle)
async def publish_article(
    article_id: UUID, body: PublishRequest, ctx: AuthCtx = CurrentUser
) -> CmsArticle:
    """Publish now (`scheduled_at: null`) or schedule a future publish.

    Idempotent: re-publishing a live article returns it unchanged with its
    original published_at, and re-scheduling to the same instant is a no-op.
    """

    def _plan(article: CmsArticle) -> publish_rules.Transition:
        return publish_rules.plan_publish(article, scheduled_at=body.scheduled_at)

    try:
        article = await revisions_repo.set_publication(
            article_id, user_id=ctx.user_id, planner=_plan
        )
    except publish_rules.PublishGuard as exc:
        raise _guard_to_http(exc) from exc
    except revisions_repo.SlugTaken as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "slug_taken", "message": str(exc)},
        ) from exc

    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return article


@router.post("/articles/{article_id}/unpublish", response_model=CmsArticle)
async def unpublish_article(
    article_id: UUID, ctx: AuthCtx = CurrentUser
) -> CmsArticle:
    """Take an article off the public surface (or cancel a schedule).

    The slug is NOT released — see cms/publish.py. Idempotent on a draft."""
    try:
        article = await revisions_repo.set_publication(
            article_id, user_id=ctx.user_id, planner=publish_rules.plan_unpublish
        )
    except publish_rules.PublishGuard as exc:
        raise _guard_to_http(exc) from exc

    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return article


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------


@router.get("/collections", response_model=list[Collection])
async def list_collections(ctx: AuthCtx = CurrentUser) -> list[Collection]:
    return await collections_repo.list_for_user(ctx.user_id)


@router.post(
    "/collections", response_model=Collection, status_code=status.HTTP_201_CREATED
)
async def create_collection(
    body: CollectionCreate, ctx: AuthCtx = CurrentUser
) -> Collection:
    try:
        return await collections_repo.create(
            user_id=ctx.user_id,
            name=body.name,
            description=body.description,
            slug=body.slug,
        )
    except collections_repo.CollectionSlugTaken as exc:
        # The repo auto-disambiguates, so this only fires when a concurrent
        # create took the resolved slug first. A 409 tells the client to
        # retry; a 500 would look like our bug.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "collection_slug_taken", "message": str(exc)},
        ) from exc


@router.patch("/collections/{collection_id}", response_model=Collection)
async def update_collection(
    collection_id: UUID, body: CollectionUpdate, ctx: AuthCtx = CurrentUser
) -> Collection:
    try:
        collection = await collections_repo.update(
            collection_id,
            user_id=ctx.user_id,
            name=body.name,
            description=body.description,
            slug=body.slug,
        )
    except collections_repo.CollectionSlugTaken as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "collection_slug_taken", "message": str(exc)},
        ) from exc
    if collection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return collection


@router.delete("/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(
    collection_id: UUID, ctx: AuthCtx = CurrentUser
) -> Response:
    if not await collections_repo.delete(collection_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    # The articles themselves survive — only the grouping is removed.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class AssignResult(BaseModel):
    collection_id: UUID
    added: int
    #: Full membership after the call, so the client doesn't re-fetch.
    article_ids: list[UUID]


@router.post("/collections/{collection_id}/articles", response_model=AssignResult)
async def assign_articles(
    collection_id: UUID, body: CollectionAssign, ctx: AuthCtx = CurrentUser
) -> AssignResult:
    """Add articles to a collection. Idempotent; unknown or foreign article
    ids are skipped rather than erroring the whole batch."""
    if await collections_repo.get(collection_id, user_id=ctx.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    added = await collections_repo.assign(
        collection_id, user_id=ctx.user_id, article_ids=body.article_ids
    )
    return AssignResult(
        collection_id=collection_id,
        added=added,
        article_ids=await collections_repo.article_ids(
            collection_id, user_id=ctx.user_id
        ),
    )


# ---------------------------------------------------------------------------
# Bulk topic queueing
# ---------------------------------------------------------------------------


@router.post(
    "/bulk-topics",
    response_model=BulkTopicsAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def bulk_topics(body: BulkTopics, ctx: AuthCtx = CurrentUser) -> BulkTopicsAccepted:
    """Queue one pipeline run per topic — the "paste your content calendar"
    entry point.

    Reuses the exact enqueue path of `POST /api/v1/articles` (create the row,
    spawn `run_article_pipeline` against it); nothing about the pipeline is
    reimplemented here, so bulk and single runs cannot drift.

    Rows are created one at a time and spawned as they are created. A
    provider hiccup partway through therefore leaves the already-created
    articles queued and running rather than rolling back work the user has
    effectively already asked for — the response reports what was accepted.
    """
    import modal

    from marketer.repos import articles as articles_repo
    from marketer.repos import niches as niches_repo

    niche = await niches_repo.get(body.niche_id, user_id=ctx.user_id)
    if niche is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="niche not found")

    fn = modal.Function.from_name("marketer-sh", "run_article_pipeline")
    created: list[UUID] = []
    for topic in body.topics:
        article = await articles_repo.create(
            user_id=ctx.user_id, niche_id=body.niche_id, topic=topic
        )
        fn.spawn(ctx.user_id, str(body.niche_id), str(article.id), topic)
        created.append(article.id)

    return BulkTopicsAccepted(queued=len(created), article_ids=created)
