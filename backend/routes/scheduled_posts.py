"""Scheduled posts — the calendar surface for hand-authored social posts.

- GET    /api/v1/scheduled-posts                  — list (status/window)
- POST   /api/v1/scheduled-posts                  — schedule one (201)
- GET    /api/v1/scheduled-posts/recurring        — weekly slot templates
- POST   /api/v1/scheduled-posts/recurring        — create a slot (201)
- DELETE /api/v1/scheduled-posts/recurring/{id}   — delete a slot (204)
- POST   /api/v1/scheduled-posts/import           — bulk CSV upload
- GET    /api/v1/scheduled-posts/{id}             — detail + per-platform status
- PATCH  /api/v1/scheduled-posts/{id}             — partial edit / reschedule
- DELETE /api/v1/scheduled-posts/{id}             — 204, only while undispatched
- POST   /api/v1/scheduled-posts/{id}/publish-now — 202, jump the queue

ROUTE ORDERING HAZARD
---------------------
`/recurring` and `/import` are declared BEFORE `/{post_id}`. FastAPI (like
Starlette) matches routes in declaration order, and `/{post_id}` is a
single-segment wildcard that happily swallows the literal strings
"recurring" and "import" — the handler would then 422 on `post_id` not
being a UUID, or worse, 404 confusingly. Declaration order is the only
thing separating them, so do not reorder the handlers in this file.

Everything is user-scoped: the repo carries `user_id` in every WHERE
clause, so another tenant's UUID reads as 404 rather than as their post.

The dispatch loop itself lives in `marketer.scheduling.dispatch`; the cron
entrypoint is `dispatch.run_due_dispatch`, which a thin Modal wrapper
calls on a schedule. Nothing in this module runs on a timer.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response, status

from marketer.repos import scheduled_posts as posts_repo
from marketer.repos.scheduled_posts import ConflictError
from marketer.scheduling import importer
from marketer.scheduling.schemas import (
    RecurringSlot,
    RecurringSlotCreate,
    ScheduledPost,
    ScheduledPostCreate,
    ScheduledPostUpdate,
)

from ..auth import AuthCtx, CurrentUser
from ..hosted_safety import refuse_if_flag_off

router = APIRouter()

MODAL_APP = "marketer-sh"
# The lead wires this Modal function; the route only spawns it. Publishing
# is an outbound HTTP fan-out that can take tens of seconds per platform,
# which is not something to hold an API worker on.
PUBLISH_FUNCTION = "publish_scheduled_post"


# --------------------------------------------------------------------------
# collection
# --------------------------------------------------------------------------

@router.get("", response_model=list[ScheduledPost])
async def list_scheduled_posts(
    ctx: AuthCtx = CurrentUser,
    status_filter: str | None = Query(default=None, alias="status"),
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ScheduledPost]:
    """Window/status listing, ascending by scheduled time.

    `from`/`to` are spelled that way in the contract; `from` is a Python
    keyword, hence the aliases. `status=due` is a derived filter
    (scheduled and past its time), not a stored value — see
    scheduling.schemas.PostStatus for why 'due' is never materialised.
    """
    if start is not None and end is not None and end <= start:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "to must be after from")
    return await posts_repo.list_for_user(
        ctx.user_id, status=status_filter, start=start, end=end, limit=limit
    )


@router.post("", response_model=ScheduledPost, status_code=status.HTTP_201_CREATED)
async def create_scheduled_post(
    body: ScheduledPostCreate, ctx: AuthCtx = CurrentUser
) -> ScheduledPost:
    """Schedule a post. 201 because this creates a durable resource the
    client will poll/edit — not 202: nothing is dispatched yet, the cron
    picks it up when it comes due.

    Platform normalisation, DST-safe UTC coercion and the
    "needs content or media" rule all live in ScheduledPostCreate, so a
    bad body is a 422 from validation before any row is written.
    """
    return await posts_repo.create(body, user_id=ctx.user_id)


# --------------------------------------------------------------------------
# recurring slot templates
#
# DECLARED BEFORE /{post_id} — see the module docstring.
# --------------------------------------------------------------------------

@router.get("/recurring", response_model=list[RecurringSlot])
async def list_recurring_slots(
    ctx: AuthCtx = CurrentUser, active_only: bool = False
) -> list[RecurringSlot]:
    return await posts_repo.list_slots(ctx.user_id, active_only=active_only)


@router.post("/recurring", response_model=RecurringSlot,
             status_code=status.HTTP_201_CREATED)
async def create_recurring_slot(
    body: RecurringSlotCreate, ctx: AuthCtx = CurrentUser
) -> RecurringSlot:
    """Create a weekly template ("Mon 09:00 America/New_York").

    The slot stores local wall-clock time, never a UTC offset:
    `scheduling.slots.expand` re-derives the instant per occurrence so the
    post stays at 09:00 local across a DST transition instead of drifting
    an hour for half the year.
    """
    return await posts_repo.create_slot(body, user_id=ctx.user_id)


@router.delete("/recurring/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recurring_slot(slot_id: UUID, ctx: AuthCtx = CurrentUser) -> Response:
    """Deleting a template never deletes the posts it already produced —
    the FK is `on delete set null`. Some of those posts may already be
    live on a real account."""
    if not await posts_repo.delete_slot(slot_id, user_id=ctx.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# bulk import
#
# DECLARED BEFORE /{post_id} — see the module docstring.
# --------------------------------------------------------------------------

@router.post("/import")
async def import_scheduled_posts(request: Request, ctx: AuthCtx = CurrentUser) -> dict:
    """Bulk CSV import: multipart upload, or a raw `text/csv` body.

    Always 200 with `{"created": n, "errors": [{"row": i, "message": ...}]}`
    — the per-row report *is* the contract, and a 4xx with a body the
    client has to parse anyway buys nothing.

    All-or-nothing: `parse_csv` validates every row before we write any of
    them, so a file with one bad row creates nothing. The alternative
    (commit the good rows, report the bad) leaves the user with no safe
    next action — re-uploading the corrected file would duplicate every
    row that already landed, and a hand-authored post has no natural dedup
    key to save them.

    The multipart body is parsed in `importer.extract_csv` with the stdlib
    `email` package because this project ships without python-multipart.
    """
    raw = await request.body()
    try:
        payload = importer.extract_csv(raw, request.headers.get("content-type"))
    except importer.ImportFormatError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    parsed = importer.parse_csv(payload)
    if not parsed.ok:
        return {
            "created": 0,
            "errors": [{"row": e.row, "message": e.message} for e in parsed.errors],
        }

    created = 0
    for index, post in enumerate(parsed.posts, start=2):  # row 1 is the header
        try:
            await posts_repo.create(post, user_id=ctx.user_id, source="import")
        except Exception as e:  # noqa: BLE001 - a write failure here is a DB fault
            # Validation already passed for every row, so reaching this means
            # the datastore itself faulted mid-file. Report exactly how far we
            # got: the user needs to know which rows to trim before re-uploading,
            # since re-sending the whole file would duplicate what did land.
            return {
                "created": created,
                "errors": [{"row": index, "message": f"could not save row: {e}"}],
            }
        created += 1
    return {"created": created, "errors": []}


# --------------------------------------------------------------------------
# single post
# --------------------------------------------------------------------------

@router.get("/{post_id}", response_model=ScheduledPost)
async def get_scheduled_post(post_id: UUID, ctx: AuthCtx = CurrentUser) -> ScheduledPost:
    """The post plus its per-platform variant statuses (the response model
    carries `variants`, each with its own status/provider_post_id/error)."""
    post = await posts_repo.get(post_id, user_id=ctx.user_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return post


@router.patch("/{post_id}", response_model=ScheduledPost)
async def update_scheduled_post(
    post_id: UUID, body: ScheduledPostUpdate, ctx: AuthCtx = CurrentUser
) -> ScheduledPost:
    """Partial update. Moving `scheduled_at` is the drag-to-reschedule path.

    409 rather than 404 when the post is mid-flight (`dispatching`) or
    already fully posted: the row exists and the client is allowed to know
    that, it just cannot be edited now. Re-arming a posted variant is
    exactly how a reschedule turns into a double post, so the repo only
    re-arms variants that FAILED.
    """
    if body.is_empty():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "empty patch")
    try:
        post = await posts_repo.update(post_id, user_id=ctx.user_id, patch=body)
    except ConflictError as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"post is {e.status} and can no longer be edited"
        ) from e
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return post


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scheduled_post(post_id: UUID, ctx: AuthCtx = CurrentUser) -> Response:
    """Delete an undispatched post.

    A `dispatching` post may be mid-flight to a real account, and a
    `posted`/`partial` one has live posts we cannot recall — deleting
    either would destroy the only record of what went out (including the
    provider post ids). Those are 409, not 204.
    """
    blocked = await posts_repo.delete(post_id, user_id=ctx.user_id)
    if blocked == "not_found":
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if blocked is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"post is {blocked}; only undispatched posts can be deleted",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{post_id}/publish-now", status_code=status.HTTP_202_ACCEPTED)
async def publish_now(post_id: UUID, ctx: AuthCtx = CurrentUser) -> dict:
    """Jump the queue: dispatch a scheduled post immediately.

    The claim happens HERE, synchronously, before anything is spawned.
    `claim_for_publish_now` is a single atomic `scheduled -> dispatching`
    UPDATE, so a double-click (or the cron tick landing on the same post
    in the same second) loses the race and gets a 409 instead of a second
    publish. Spawning first and claiming inside the worker would reopen
    exactly that window.

    If the process dies between the claim commit and the spawn, the post
    is parked in `dispatching` with nothing running — an orphaned claim,
    not a double publish. `repo.reap_stale` fails it back for a human to
    look at (deliberately not back to `pending`: we do not know whether
    the platform call landed, and auto-retrying an unknown outcome is how
    you double-post).
    """
    await refuse_if_flag_off("publish")
    claimed = await posts_repo.claim_for_publish_now(post_id, user_id=ctx.user_id)
    if claimed is None:
        existing = await posts_repo.get(post_id, user_id=ctx.user_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"post is {existing.status}, not scheduled",
        )

    import modal

    fn = modal.Function.from_name(MODAL_APP, PUBLISH_FUNCTION)
    fn.spawn(ctx.user_id, str(post_id))
    return {"status": "dispatching", "post_id": str(post_id)}
