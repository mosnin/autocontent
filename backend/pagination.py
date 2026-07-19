"""Reusable opaque-cursor (keyset) pagination for list endpoints.

Why keyset instead of offset/limit: offset pagination re-scans and
re-sorts everything before the offset on every page (O(n) per page, O(n^2)
overall) and produces duplicate/skipped rows when rows are inserted or
deleted between requests. Keyset ("seek") pagination instead remembers the
sort key of the last row returned and asks the database for rows strictly
past it — O(log n + limit) per page via the existing index, and stable
under concurrent writes.

This module standardises that pattern behind three pieces:

* ``PageParams`` — a FastAPI dependency exposing ``limit`` (bounded) and an
  opaque ``cursor`` string from query params.
* ``Page[T]`` — the response envelope: ``{items, next_cursor, has_more}``.
* ``encode_cursor`` / ``decode_cursor`` — turn a ``(created_at, id)`` keyset
  position into an opaque, tamper-evident string and back.
* ``build_page`` — turns an "n+1" ordered result list into a ``Page[T]``.

Worked example (a hypothetical ``/api/v1/campaigns`` list route — this
module does not touch routes, Phase-1 teams wire it in):

    from fastapi import APIRouter, Depends
    from backend.pagination import PageParams, Page, decode_cursor, build_page

    router = APIRouter()

    @router.get("/campaigns", response_model=Page[CampaignOut])
    async def list_campaigns(params: PageParams = Depends()):
        after = decode_cursor(params.cursor)  # CursorPosition | None

        # Keyset predicate: strictly "older" than the cursor position in
        # (created_at DESC, id DESC) order. Fetch one extra row (limit + 1)
        # so we can tell whether there's a next page without a COUNT(*).
        query = '''
            SELECT id, created_at, name, status
            FROM campaigns
            WHERE ($1::timestamptz IS NULL)
               OR (created_at, id) < ($1::timestamptz, $2::uuid)
            ORDER BY created_at DESC, id DESC
            LIMIT $3
        '''
        rows = await conn.fetch(
            query,
            after.created_at if after else None,
            after.id if after else None,
            params.limit + 1,
        )
        items = [CampaignOut.model_validate(dict(r)) for r in rows]

        # build_page slices off the lookahead row, and derives next_cursor
        # from the (created_at, id) of the last item actually returned.
        return build_page(
            items,
            limit=params.limit,
            cursor_key=lambda c: (c.created_at, c.id),
        )

The important invariants a repo query MUST honor for this to work:

1. The ORDER BY must exactly match the tie-break used in the cursor —
   ``ORDER BY created_at DESC, id DESC`` (id as a secondary sort breaks
   ties between rows with an identical ``created_at``, which timestamps
   truncated to millisecond/microsecond precision make routine).
2. The WHERE predicate must use the *tuple* comparison
   ``(created_at, id) < (cursor.created_at, cursor.id)`` (or the row-wise
   equivalent on databases without native tuple comparison), not two
   independent ``created_at <= ... AND id < ...`` clauses — the latter
   silently drops rows that share the boundary ``created_at``.
3. Fetch ``limit + 1`` rows; ``build_page`` uses the extra row purely to
   set ``has_more`` and then discards it.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Generic, TypeVar

from fastapi import HTTPException, Query, status
from pydantic import BaseModel

T = TypeVar("T")

DEFAULT_LIMIT = 20
MAX_LIMIT = 100

# HMAC key used to make cursors tamper-evident (not secret-critical — a
# forged cursor only lets a client skip to an arbitrary page position it
# could already reach by paging normally, never bypasses auth/ownership
# filters, which every route applies independently in its WHERE clause).
# Deployments that want cross-restart cursor stability under key rotation
# should set MARKETER_CURSOR_SIGNING_KEY explicitly.
_SIGNING_KEY = os.environ.get("MARKETER_CURSOR_SIGNING_KEY", "marketer-pagination-cursor-v1").encode()

_CURSOR_VERSION = 1


class CursorDecodeError(ValueError):
    """Raised internally when a client-supplied cursor is malformed or forged."""


@dataclass(frozen=True)
class CursorPosition:
    """The keyset position a cursor encodes: the (created_at, id) of the
    last row a client has already seen."""

    created_at: datetime
    id: str


def _sign(payload: bytes) -> str:
    return hmac.new(_SIGNING_KEY, payload, hashlib.sha256).hexdigest()[:32]


def encode_cursor(created_at: datetime, id_: str) -> str:
    """Encode a keyset position into an opaque, base64, tamper-evident cursor.

    The cursor is base64(json({v, created_at, id, sig})) — not encryption,
    just a signature that makes accidental or malicious edits to the cursor
    detectable (decode_cursor raises CursorDecodeError) rather than silently
    seeking to an unintended, possibly-invalid position.
    """
    body = {
        "v": _CURSOR_VERSION,
        "created_at": created_at.isoformat(),
        "id": id_,
    }
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode()
    sig = _sign(raw)
    envelope = {"body": base64.urlsafe_b64encode(raw).decode(), "sig": sig}
    return base64.urlsafe_b64encode(
        json.dumps(envelope, separators=(",", ":")).encode()
    ).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> CursorPosition | None:
    """Decode an opaque cursor back into a ``CursorPosition``.

    Returns ``None`` for a missing/empty cursor (i.e. "first page").
    Raises ``CursorDecodeError`` if the cursor is malformed or its
    signature doesn't match (tampered or from a different signing key) —
    callers (e.g. ``PageParams``) turn that into a 400 for API clients.
    """
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        envelope = json.loads(base64.urlsafe_b64decode(padded.encode()))
        raw = base64.urlsafe_b64decode(envelope["body"])
        expected_sig = _sign(raw)
        if not hmac.compare_digest(expected_sig, envelope["sig"]):
            raise CursorDecodeError("cursor signature mismatch")
        body = json.loads(raw)
        if body.get("v") != _CURSOR_VERSION:
            raise CursorDecodeError("unsupported cursor version")
        return CursorPosition(
            created_at=datetime.fromisoformat(body["created_at"]),
            id=body["id"],
        )
    except CursorDecodeError:
        raise
    except Exception as exc:  # noqa: BLE001 — any parse failure is a bad cursor
        raise CursorDecodeError("malformed cursor") from exc


class PageParams:
    """FastAPI dependency: bounded ``limit`` + opaque ``cursor`` query params.

    Usage: ``params: PageParams = Depends()`` in a route signature. Invalid
    cursors raise a 400 ``HTTPException`` (mapped by ``backend.errors`` into
    the standard error envelope with code ``bad_request``) before the route
    body ever runs.
    """

    def __init__(
        self,
        limit: int = Query(
            DEFAULT_LIMIT, ge=1, le=MAX_LIMIT, description="Max items per page."
        ),
        cursor: str | None = Query(
            None, description="Opaque pagination cursor from a previous page's next_cursor."
        ),
    ) -> None:
        self.limit = limit
        self.cursor = cursor

    @property
    def position(self) -> CursorPosition | None:
        """Decode ``cursor`` into a ``CursorPosition``, raising HTTP 400 on
        a malformed/tampered cursor rather than surfacing the raw parse
        error to the route."""
        try:
            return decode_cursor(self.cursor)
        except CursorDecodeError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"invalid cursor: {exc}") from exc


class Page(BaseModel, Generic[T]):
    """Standard list-endpoint response envelope."""

    items: list[T]
    next_cursor: str | None = None
    has_more: bool = False


def build_page(
    rows: Sequence[T],
    *,
    limit: int,
    cursor_key: Callable[[T], tuple[datetime, str]],
) -> Page[T]:
    """Build a ``Page[T]`` from an n+1 ordered query result.

    ``rows`` must be the result of a query that fetched ``limit + 1`` rows
    ordered by ``(created_at DESC, id DESC)`` (see module docstring). This
    slices off the lookahead row, sets ``has_more`` accordingly, and derives
    ``next_cursor`` from the ``(created_at, id)`` of the last item actually
    returned via ``cursor_key``.

    ``cursor_key(item) -> (created_at, id)`` lets callers pass either ORM
    rows/dataclasses or Pydantic models without this module knowing their
    shape.
    """
    has_more = len(rows) > limit
    items = list(rows[:limit])
    next_cursor: str | None = None
    if has_more and items:
        created_at, id_ = cursor_key(items[-1])
        next_cursor = encode_cursor(created_at, id_)
    return Page(items=items, next_cursor=next_cursor, has_more=has_more)
