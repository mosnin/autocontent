"""Every API route must require a caller identity.

The API surface is now assembled from many independently-written route
modules. Auth here is opt-in per endpoint — a handler declares
`ctx: AuthCtx = CurrentUser` (or `AdminCtx = CurrentAdmin`) — so an
endpoint that forgets the parameter is not a loud failure. It is a
working, user-scoped-*looking* endpoint that serves or mutates whatever
the path says, for anyone who can reach it. Neither the type system nor
the router notices.

This test inverts that default: a route without an identity dependency
must be named in `PUBLIC_ROUTES` with the mechanism that replaces the
session. Callers that are not users — payment processors, render
providers, load balancers — cannot present one, so they authenticate the
*request* instead (an HMAC signature, a shared secret). "It's public" is
never a sufficient reason, which is why the allowlist stores prose.

Note on route discovery: this FastAPI version includes routers lazily, so
`app.routes` holds `_IncludedRouter` wrappers rather than flattened
`APIRoute`s. Walking only the top level silently finds ZERO routes and a
naive version of this test passes while checking nothing — hence
`_flatten`, and hence the assertion that the discovered count is sane.
"""
from __future__ import annotations

from typing import Any

from fastapi.routing import APIRoute

from backend.auth import require_admin, require_user
from backend.main import create_app

# path -> the mechanism that authenticates the request in place of a session.
PUBLIC_ROUTES: dict[str, str] = {
    "/healthz": "liveness probe; returns no user data",
    "/healthz/deep": "dependency probe; returns no user data",
    "/api/v1/billing/webhook": "authenticated by the Stripe signature header",
    "/api/v1/webhooks/ayrshare": "authenticated by HMAC-SHA256 over the raw body",
    "/api/v1/ugc/webhook": "authenticated by a shared secret, compared in constant time",
    # OAuth 2.1 authorization server (docs/OAUTH.md). Each of these carries
    # its own authentication, which is why none of them takes CurrentUser:
    "/.well-known/oauth-authorization-server": (
        "RFC 8414 discovery document; static, deployment-level metadata and no user data"
    ),
    "/.well-known/oauth-protected-resource": (
        "RFC 9728 discovery document; static, deployment-level metadata and no user data"
    ),
    "/oauth/authorize": (
        "gated by the visitor's own Clerk session, read from the __session cookie "
        "(backend.auth.resolve_browser_session); a signed-out visitor is sent to "
        "/sign-in and back, and the POST additionally requires a pending consent row "
        "bound to that same user"
    ),
    "/oauth/token": (
        "authenticated by the OAuth client: PKCE proof-of-possession of the "
        "authorization code, plus a client secret for confidential clients"
    ),
    "/oauth/revoke": (
        "authenticated by the OAuth client, and it only ever revokes a grant that "
        "client owns; RFC 7009 requires 200 for an unknown token"
    ),
    "/oauth/userinfo": (
        "authenticated by an OAuth access token, looked up by sha256 and required to "
        "carry the openid scope"
    ),
}

# Anything that establishes who is calling. `require_admin` is strictly
# stronger than `require_user`, so it satisfies the requirement too.
IDENTITY_DEPENDENCIES = {require_user, require_admin}


def _flatten(routes: list[Any], prefix: str = "") -> list[tuple[str, APIRoute]]:
    """Every APIRoute in the app, with its fully-qualified path."""
    found: list[tuple[str, APIRoute]] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append((prefix + route.path, route))
        elif route.__class__.__name__ == "_IncludedRouter":
            context = getattr(route, "include_context", None)
            found += _flatten(
                route.original_router.routes, prefix + (getattr(context, "prefix", "") or "")
            )
        elif hasattr(route, "routes"):
            found += _flatten(route.routes, prefix)
    return found


def _dependency_calls(route: APIRoute) -> set[Any]:
    """Every callable in a route's resolved dependency tree.

    Walks the tree rather than reading the signature, so a route that
    picks auth up from a router-level or nested dependency still counts.
    """
    seen: set[Any] = set()

    def walk(dependant: Any) -> None:
        seen.add(dependant.call)
        for sub in dependant.dependencies:
            walk(sub)

    walk(route.dependant)
    return seen


def _routes() -> list[tuple[str, APIRoute]]:
    return _flatten(create_app().routes)


def test_every_route_requires_identity_or_is_declared_public() -> None:
    routes = _routes()
    # Guards against the lazy-router trap described in the module docstring:
    # if discovery silently returns nothing, this test proves nothing.
    assert len(routes) > 100, f"route discovery looks broken — found only {len(routes)}"

    undeclared = sorted(
        {
            path
            for path, route in routes
            if not (IDENTITY_DEPENDENCIES & _dependency_calls(route))
            and path not in PUBLIC_ROUTES
        }
    )
    assert not undeclared, (
        "these routes neither require a caller identity nor appear in "
        "PUBLIC_ROUTES, so they are reachable by anyone who can reach the "
        f"API: {undeclared}"
    )


def test_public_allowlist_has_no_dead_entries() -> None:
    """A stale exemption is a standing offer to expose whatever route next
    claims that path."""
    live = {path for path, _ in _routes()}
    stale = sorted(path for path in PUBLIC_ROUTES if path not in live)
    assert not stale, f"PUBLIC_ROUTES exempts paths that no longer exist: {stale}"
