"""``Idempotency-Key`` support for external/agent callers of the HTTP API.

Reuses cycle-2's durable idempotency store (``marketer.repos.idempotency`` /
``db/migrations/0024_idempotency.sql``) — same table, same atomic
``claim()`` primitive, same fail-open philosophy — but adds a second layer
on top: caching and replaying the *response* of a mutating request, not
just deduping a Modal spawn.

Why an ASGI middleware and not a FastAPI dependency
----------------------------------------------------
A dependency runs *before* the route body and has no clean way to observe
(let alone rewrite) the response that route eventually returns — you'd
need a second dependency, response-model surgery, or per-route
boilerplate to also capture and replay output. An ASGI middleware sits on
both sides of the whole request/response cycle for every route in one
place: it can buffer the inbound body (for hashing), let the request run
untouched, capture the outbound status/headers/body as they stream past,
and short-circuit entirely for a replay — all without touching a single
route handler.

Design
------
Storage key: ``sha256(f"{user_id}\\n{method}\\n{path}\\n{idempotency_key}")``.
Scoped to the authenticated caller so one user's key can never collide
with another's, and to (method, path) so the same key string reused
against a different endpoint is a distinct unit of work. The *raw*
Idempotency-Key value never has to be a well-formed Postgres text key by
itself (callers may send arbitrarily long/odd strings) — hashing the
whole tuple sidesteps that entirely.

Body-hash conflict (IETF idempotency-key draft, first-request semantics):
the sha256 of the raw request body is recorded on the *first* claim
(before the handler runs, via ``record_body_hash``) and re-checked on
every subsequent request bearing the same key — while still in flight
*and* after completion. A different body under the same key is a client
bug (or a colliding, coincidental key reuse) and gets a 422, never a
silent replay of somebody else's response and never a second execution.

State machine per (user, method, path, key):
  1. No row / expired row  -> ``claim()`` succeeds -> record body hash ->
     run the handler -> persist the full response -> return it live.
  2. Row claimed, not yet done, same body hash      -> 409 (in flight).
  3. Row claimed, not yet done, hash unrecorded yet  -> 409 (in flight;
     the tiny window between claim() succeeding and record_body_hash()
     landing is treated conservatively as "still processing" rather than
     risking a false negative on the conflict check).
  4. Row done, same body hash                        -> replay the stored
     response verbatim + ``Idempotency-Replayed: true``.
  5. Any row, different body hash                     -> 422 conflict.

Untouched, zero-overhead paths: GET/HEAD/OPTIONS and any mutating request
with no ``Idempotency-Key`` header skip every bit of this module (no DB
calls, no auth resolution) before falling straight through to the app.

Fail-open (claim path only)
----------------------------
If the idempotency store itself is unreachable when *claiming*
(``claim()`` raising) we log at ERROR and let the request through
un-deduplicated, mirroring ``marketer.services.idempotency.claim_spawn``'s
philosophy: a dead dedup store must never become a global API outage. The
same applies to the read used to decide 409-vs-422-vs-replay for an
existing claim — if that read fails we also fail open (run the handler)
rather than wedge the caller on a store outage. Post-hoc bookkeeping
(``record_body_hash``, persisting the final response) is best-effort by
design in the repo layer already — losing it only costs a future replay's
ability to hit the cache, never the correctness of the request that's
actually in flight.

Auth resolution
----------------
The middleware reuses ``backend.auth.require_user`` to resolve the caller
so the scoping key is tied to a real identity, not a spoofable header. If
that resolution fails for any reason (missing/invalid bearer, DB hiccup)
the middleware does *not* itself raise a 401 — it has no reliable way to
render the app's exact error contract from outside the routing/exception
stack, and raising here would escape FastAPI's exception handlers (this
middleware runs outside ``ExceptionMiddleware`` in the stack). Instead it
steps aside; the route's own ``CurrentUser`` dependency runs moments
later and produces the real, correctly-formatted 401. The one cost is
running auth resolution twice on a request that both carries the header
and succeeds — a deliberate trade favoring correctness/simplicity of the
error path over saving one token lookup.
"""
from __future__ import annotations

import hashlib
import logging

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from marketer.repos import idempotency as idempotency_repo

from .auth import require_user

logger = logging.getLogger(__name__)

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_HEADER_NAME = "idempotency-key"
_REPLAYED_HEADER = "idempotency-replayed"


def derive_storage_key(user_id: str, method: str, path: str, idempotency_key: str) -> str:
    """Storage key scoped to (authenticated user, method, path, key).

    Hashed (rather than concatenated raw) so an arbitrarily long or
    odd caller-supplied key string never becomes an oversized/unsafe
    Postgres primary key, and so a literal delimiter in one of the parts
    can't be used to forge a collision with a different tuple."""
    raw = f"{user_id}\n{method.upper()}\n{path}\n{idempotency_key}"
    return "idem-api:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def hash_body(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


async def _resolve_user_id(request: Request) -> str | None:
    """Best-effort caller identity for scoping. Returns None on any auth
    failure — the caller falls through untouched and the route's own auth
    dependency renders the real error response (see module docstring)."""
    try:
        ctx = await require_user(request)
    except Exception:  # noqa: BLE001 — auth failures render downstream, not here
        return None
    return ctx.user_id


def _make_replay_receive(body: bytes) -> Receive:
    """A ``receive`` callable that replays a fully-buffered body once,
    then defers to nothing further (mutating requests handled here are
    small, buffered JSON payloads — no further body chunks are expected;
    a follow-up ``http.disconnect`` isn't needed for these short-lived
    unary request/response cycles)."""
    delivered = False

    async def _receive() -> Message:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    return _receive


async def _send_json(scope: Scope, send: Send, status_code: int, payload: dict) -> None:
    response = JSONResponse(payload, status_code=status_code)
    await response(scope, _make_replay_receive(b""), send)


async def _send_stored_response(scope: Scope, send: Send, stored: dict) -> None:
    status_code = int(stored.get("status", 200))
    headers = dict(stored.get("headers") or {})
    body_text = stored.get("body", "")
    body_bytes = body_text.encode("utf-8") if isinstance(body_text, str) else bytes(body_text)

    # Drop content-length so Response recomputes it for *this* body (it
    # always matches, but recomputing costs nothing and avoids ever
    # trusting a stored header over the bytes actually being sent).
    headers.pop("content-length", None)
    response = Response(content=body_bytes, status_code=status_code, headers=headers)
    response.headers[_REPLAYED_HEADER] = "true"
    await response(scope, _make_replay_receive(b""), send)


class IdempotencyMiddleware:
    """Pure-ASGI middleware implementing ``Idempotency-Key`` semantics for
    mutating requests. See module docstring for the full design."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in _MUTATING_METHODS:
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        idem_key = request.headers.get(_HEADER_NAME)
        if not idem_key:
            await self.app(scope, receive, send)
            return

        # Buffer the body once: we need it for the hash, and the downstream
        # app needs to see it too, so replay it via a fresh receive().
        body = await request.body()
        receive = _make_replay_receive(body)

        user_id = await _resolve_user_id(request)
        if user_id is None:
            await self.app(scope, receive, send)
            return

        storage_key = derive_storage_key(user_id, request.method, request.url.path, idem_key)
        body_hash = hash_body(body)

        try:
            claimed = await idempotency_repo.claim(storage_key)
        except Exception:  # noqa: BLE001 — fail open on a claim-path outage
            logger.error(
                "idempotency_api: store unreachable claiming key=%r — proceeding "
                "without dedup (fail open); a duplicate execution is possible "
                "until the store recovers.",
                storage_key,
                exc_info=True,
            )
            await self.app(scope, receive, send)
            return

        if claimed:
            await self._run_and_persist(scope, receive, send, storage_key, body_hash)
            return

        await self._handle_existing_claim(scope, receive, send, storage_key, body_hash)

    async def _handle_existing_claim(
        self, scope: Scope, receive: Receive, send: Send, storage_key: str, body_hash: str
    ) -> None:
        try:
            record = await idempotency_repo.get_record(storage_key)
        except Exception:  # noqa: BLE001 — fail open on the claim-path read too
            logger.error(
                "idempotency_api: store unreachable reading existing claim "
                "key=%r — proceeding without dedup (fail open).",
                storage_key,
                exc_info=True,
            )
            await self.app(scope, receive, send)
            return

        if record is None:
            # Reclaimed/expired/reaped between our failed claim() and this
            # read (vanishingly rare). Safest is to just run the request
            # rather than retry-claim and add more branches for a race this
            # narrow.
            await self.app(scope, receive, send)
            return

        stored_hash = record.get("body_hash")
        if stored_hash is not None and stored_hash != body_hash:
            # Match the app-wide structured error envelope (backend/errors.py):
            # this middleware runs outside FastAPI's exception handlers, so it
            # builds the same {"error": {...}} shape itself rather than leaking
            # a divergent {"detail": ...} body.
            await _send_json(
                scope,
                send,
                422,
                {
                    "error": {
                        "code": "idempotency_key_reused",
                        "message": (
                            "Idempotency-Key was already used with a different "
                            "request body. Use a new key for a new request."
                        ),
                        "hint": "Generate a fresh Idempotency-Key per distinct request.",
                        "retryable": False,
                        "details": None,
                    }
                },
            )
            return

        response = record.get("response")
        if record.get("status") != "done" or response is None:
            await _send_json(
                scope,
                send,
                409,
                {
                    "error": {
                        "code": "idempotency_in_progress",
                        "message": "request with this Idempotency-Key is still being processed",
                        "hint": "Retry after the original request completes.",
                        "retryable": True,
                        "details": None,
                    }
                },
            )
            return

        await _send_stored_response(scope, send, response)

    async def _run_and_persist(
        self, scope: Scope, receive: Receive, send: Send, storage_key: str, body_hash: str
    ) -> None:
        try:
            await idempotency_repo.record_body_hash(storage_key, body_hash)
        except Exception:  # noqa: BLE001 — best-effort bookkeeping only
            logger.error(
                "idempotency_api: failed to record body hash for key=%r "
                "(conflict detection may be delayed for concurrent racers)",
                storage_key,
                exc_info=True,
            )

        captured: dict = {"status": 200, "headers": {}, "body": bytearray(), "decodable": True}

        async def _send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                captured["status"] = message["status"]
                captured["headers"] = {
                    k.decode("latin-1"): v.decode("latin-1") for k, v in message.get("headers", [])
                }
            elif message["type"] == "http.response.body":
                captured["body"].extend(message.get("body", b""))
            await send(message)

        await self.app(scope, receive, _send_wrapper)

        try:
            body_text = bytes(captured["body"]).decode("utf-8")
        except UnicodeDecodeError:
            logger.warning(
                "idempotency_api: response body for key=%r is not valid UTF-8 "
                "— skipping response caching for this key (request already "
                "succeeded; only the replay cache is affected).",
                storage_key,
            )
            return

        try:
            await idempotency_repo.store_response(
                storage_key,
                body_hash=body_hash,
                status=captured["status"],
                headers=captured["headers"],
                body=body_text,
            )
        except Exception:  # noqa: BLE001 — best-effort; response already sent
            logger.error(
                "idempotency_api: failed to persist response for key=%r — a "
                "retry with the same key will re-execute instead of replaying.",
                storage_key,
                exc_info=True,
            )
