"""Request hardening shared by every route (docs/security/backend-audit.md).

- ``BodySizeLimitMiddleware``  caps the request body before any handler or
  pydantic model sees it. Without a cap, any JSON route buffers whatever a
  client sends. The body is read here (bounded) and replayed to the app, so a
  chunked upload with no ``Content-Length`` is cut off at the same limit.
- ``SecurityHeadersMiddleware``  adds the response headers a JSON API should
  always carry.
- ``require_person``  refuses agent delegation (service token plus
  ``x-tenant-id``) on routes only a person may use: minting credentials,
  erasing or exporting the account.
- ``user_rate_limit``  a per-tenant bucket for expensive endpoints. The
  default slowapi limit is per client IP, which does nothing against one
  signed-in account spawning paid work in a loop.
"""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from limits import parse as parse_limit

from .auth import AuthCtx, require_user

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

DEFAULT_MAX_BODY_BYTES = 1024 * 1024  # 1 MiB: every JSON route fits well inside
# Longest matching prefix wins. Routes that carry base64 images or a tiny
# high-volume payload get their own ceiling.
BODY_LIMITS: tuple[tuple[str, int], ...] = (
    ("/api/v1/templates", 12 * 1024 * 1024),   # reference / product image as base64
    ("/api/v1/decisions", 64 * 1024),          # one decision row; the agent posts many
    ("/api/inngest", 4 * 1024 * 1024),         # Inngest step payloads
)
_BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def body_limit_for(path: str) -> int:
    best = DEFAULT_MAX_BODY_BYTES
    best_len = -1
    for prefix, limit in BODY_LIMITS:
        if path.startswith(prefix) and len(prefix) > best_len:
            best, best_len = limit, len(prefix)
    return best


async def _reject(send: Send, code: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send({
        "type": "http.response.start",
        "status": code,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"connection", b"close"),
        ],
    })
    await send({"type": "http.response.body", "body": body})


class BodySizeLimitMiddleware:
    """Pure ASGI. Rejects an oversized request with 413 before the app runs."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in _BODY_METHODS:
            await self.app(scope, receive, send)
            return
        limit = body_limit_for(scope.get("path", ""))
        declared = None
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                declared = value.decode("latin-1").strip()
                break
        if declared is not None:
            if not declared.isdigit():
                await _reject(send, status.HTTP_400_BAD_REQUEST, "invalid Content-Length")
                return
            if int(declared) > limit:
                await _reject(send, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "request body too large")
                return

        # Read the body here, bounded, then replay it. A client that lies about
        # (or omits) Content-Length is cut off at the same limit.
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > limit:
                await _reject(send, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "request body too large")
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


_STATIC_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
    (b"cross-origin-resource-policy", b"same-site"),
)
# JSON answers are never a document: forbid everything, and never cache them
# (they carry tenant data and one-time secrets such as new tokens).
_JSON_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cache-control", b"no-store"),
)


class SecurityHeadersMiddleware:
    """Pure ASGI. Adds headers only when the handler did not set them."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                content_type = b""
                for name, value in headers:
                    if name.lower() == b"content-type":
                        content_type = value.lower()
                extra = list(_STATIC_HEADERS)
                if content_type.startswith(b"application/json"):
                    extra.extend(_JSON_HEADERS)
                headers.extend((n, v) for n, v in extra if n not in present)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


async def require_person(ctx: AuthCtx = Depends(require_user)) -> AuthCtx:
    """A signed-in person or their own personal token. Never the agent.

    The agent service token plus ``x-tenant-id`` acts as any tenant, so
    anything that outlives the call (a personal token carries the tenant's
    stored role, admin included) or cannot be undone (erasure) is refused."""
    if getattr(ctx, "delegated", False):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "this action needs the person, not the agent acting for them",
        )
    return ctx


CurrentPerson = Depends(require_person)


def user_rate_limit(scope: str, limit: str) -> Any:
    """Route dependency: at most ``limit`` calls per authenticated tenant.

    Shares the slowapi storage (Redis when configured), so it holds across
    instances. Keyed on the authenticated user id, never on a header."""
    item = parse_limit(limit)

    async def _dep(request: Request, ctx: AuthCtx = Depends(require_user)) -> None:
        from .rate_limit import limiter

        if not getattr(limiter, "enabled", True):
            return
        if not limiter.limiter.hit(item, f"user:{scope}", ctx.user_id):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"rate limit exceeded ({limit}); slow down",
                headers={"Retry-After": str(item.get_expiry())},
            )

    return Depends(_dep)
