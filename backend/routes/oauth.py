"""OAuth 2.1 authorization server.

This is how a THIRD-PARTY application gets delegated access to a
marketer.sh account. It is not how the product's own web app talks to the
API (that is a Clerk session) and not how a user's own scripts talk to it
(that is a personal access token, ``/api/v1/tokens``).

Everything lives on this surface on purpose. The authorization server needs
two things in the same process: the human session that gates the consent
screen, and the user table the grant hangs off. This app has both. The Next
frontend only forwards ``/oauth/*`` and the two ``/.well-known`` documents
to this app (``web/next.config.js`` rewrites), so the browser stays on
marketer.sh and Clerk's ``__session`` cookie arrives with the request.

Endpoints
---------
``GET  /.well-known/oauth-authorization-server``  RFC 8414 discovery
``GET  /.well-known/oauth-protected-resource``    RFC 9728 discovery
``GET  /oauth/authorize``                          consent screen (HTML)
``POST /oauth/authorize``                          the human's decision
``POST /oauth/token``                              authorization_code, refresh_token
``POST /oauth/revoke``                             RFC 7009
``GET  /oauth/userinfo``                           OIDC-style claims

The rules that matter, in one place
-----------------------------------
* PKCE ``S256`` is required of every client and verified with
  ``hmac.compare_digest``. ``plain`` is refused at the authorize step.
* ``redirect_uri`` is matched byte for byte against the registered list at
  authorize AND again at token, against the value bound to the code.
* Authorization codes are single use and live ten minutes. Presenting one
  twice revokes the entire grant family.
* Refresh tokens are rotated on every use. Presenting a rotated one revokes
  the entire grant family.
* Codes, access tokens, refresh tokens and client secrets are stored only as
  sha256 hex.
* An error never redirects to an unvalidated URI: until the client and the
  redirect URI are known good, failures render a page.
"""
from __future__ import annotations

import base64
import binascii
import html
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote, unquote, urlsplit
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from marketer.repos import brand_kit as brand_kit_repo
from marketer.repos import oauth as oauth_repo
from marketer.repos import users as users_repo
from marketer.services import oauth as oauth_service

from ..auth import resolve_browser_session
from ..rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# RFC 6749 §5.1: token responses (and anything else carrying a credential)
# must not be cached.
NO_STORE: dict[str, str] = {"Cache-Control": "no-store", "Pragma": "no-cache"}


class OAuthProblem(Exception):
    """An error with a spec-shaped JSON body.

    Raised from dependencies and helpers where returning a Response is not
    possible. ``backend.main`` registers :func:`oauth_problem_handler` for it.
    """

    def __init__(
        self,
        status_code: int,
        body: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(body.get("error", "oauth_error"))
        self.status_code = status_code
        self.body = body
        self.headers = {**NO_STORE, **(headers or {})}


async def oauth_problem_handler(_request: Request, exc: Exception) -> JSONResponse:
    problem = exc if isinstance(exc, OAuthProblem) else OAuthProblem(500, {"error": "server_error"})
    return JSONResponse(problem.body, status_code=problem.status_code, headers=problem.headers)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(moment: datetime | None) -> bool:
    if moment is None:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment <= _now()


def _json(body: dict[str, Any], status_code: int = 200, headers: dict[str, str] | None = None):
    return JSONResponse(body, status_code=status_code, headers={**NO_STORE, **(headers or {})})


def _error(
    status_code: int,
    error: str,
    description: str = "",
    extra: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"error": error}
    if description:
        body["error_description"] = description
    if extra:
        body.update(extra)
    return _json(body, status_code=status_code, headers=headers)


def _resource_metadata_url() -> str:
    return oauth_service.endpoint("/.well-known/oauth-protected-resource")


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


@router.get("/.well-known/oauth-authorization-server")
async def authorization_server_metadata() -> JSONResponse:
    return JSONResponse(
        oauth_service.authorization_server_metadata(),
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.get("/.well-known/oauth-protected-resource")
async def protected_resource_metadata() -> JSONResponse:
    return JSONResponse(
        oauth_service.protected_resource_metadata(),
        headers={"Cache-Control": "public, max-age=300"},
    )


# ---------------------------------------------------------------------------
# Consent screen
# ---------------------------------------------------------------------------

_PAGE_CSS = """
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center;
  background: #f6f7f9; color: #14161a;
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 30rem; margin: 2rem 1rem; padding: 1.75rem;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
  box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 12px 32px -12px rgba(16,24,40,.18); }
h1 { margin: 0 0 .35rem; font-size: 1.2rem; letter-spacing: -.01em; }
p { margin: .35rem 0; color: #4b5563; }
strong { color: #14161a; }
ul { margin: 1rem 0; padding: 0; list-style: none; }
li { padding: .6rem 0; border-top: 1px solid #eef0f3; }
li span { display: block; font-size: .78rem; color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: .15rem; }
.meta { margin-top: 1rem; padding-top: .9rem; border-top: 1px solid #eef0f3;
  font-size: .8rem; color: #6b7280; word-break: break-all; }
form { display: flex; gap: .6rem; margin-top: 1.4rem; }
button { flex: 1; padding: .7rem 1rem; font: inherit; font-weight: 550;
  border-radius: 9px; border: 1px solid transparent; cursor: pointer; }
.approve { background: #14161a; color: #fff; }
.deny { background: #fff; color: #14161a; border-color: #d5d8dd; }
@media (prefers-color-scheme: dark) {
  body { background: #0b0c0e; color: #f2f3f5; }
  main { background: #141619; border-color: #24272c; }
  p, .meta { color: #9aa1ab; }
  strong { color: #f2f3f5; }
  li { border-color: #24272c; }
  .approve { background: #f2f3f5; color: #14161a; }
  .deny { background: transparent; color: #f2f3f5; border-color: #3a3e45; }
}
"""


def _page(title: str, body_html: str, status_code: int = 200) -> HTMLResponse:
    document = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<meta name=\"robots\" content=\"noindex\">"
        f"<title>{html.escape(title)}</title><style>{_PAGE_CSS}</style></head>"
        f"<body><main>{body_html}</main></body></html>"
    )
    return HTMLResponse(document, status_code=status_code, headers=NO_STORE)


def _error_page(title: str, detail: str, status_code: int = 400) -> HTMLResponse:
    """Rendered instead of a redirect whenever the redirect target is not
    proven to belong to a registered client."""
    return _page(
        title,
        f"<h1>{html.escape(title)}</h1><p>{html.escape(detail)}</p>"
        "<p class=\"meta\">Nothing was shared. Close this window and start the "
        "connection again from the application that sent you here.</p>",
        status_code=status_code,
    )


def _consent_page(
    *,
    request_id: UUID,
    client_name: str,
    workspace_label: str,
    subject_label: str,
    scopes: list[str],
    redirect_uri: str,
) -> HTMLResponse:
    lines = "".join(
        f"<li>{html.escape(sentence)}<span>{html.escape(scope)}</span></li>"
        for scope, sentence in oauth_service.describe_scopes(scopes)
    )
    host = urlsplit(redirect_uri).netloc
    body = (
        f"<h1>Connect {html.escape(client_name)}</h1>"
        f"<p><strong>{html.escape(client_name)}</strong> is asking for access to "
        f"<strong>{html.escape(workspace_label)}</strong> on marketer.sh.</p>"
        f"<p>Signed in as {html.escape(subject_label)}.</p>"
        f"<ul>{lines}</ul>"
        f"<p class=\"meta\">Approving sends you back to {html.escape(host)}. "
        "You can disconnect at any time, and this access is read only unless a "
        "write permission is listed above.</p>"
        "<form method=\"post\" action=\"/oauth/authorize\">"
        f"<input type=\"hidden\" name=\"request_id\" value=\"{html.escape(str(request_id))}\">"
        "<button class=\"deny\" type=\"submit\" name=\"decision\" value=\"deny\">Deny</button>"
        "<button class=\"approve\" type=\"submit\" name=\"decision\" value=\"approve\">Approve</button>"
        "</form>"
    )
    return _page(f"Connect {client_name}", body)


def _public_url(request: Request) -> str:
    """This request as the browser sees it, on the public origin.

    The frontend rewrites /oauth/* to this app, so request.url carries the
    internal host. Sign-in has to come back to the public one.
    """
    query = request.url.query
    return f"{oauth_service.issuer()}{request.url.path}" + (f"?{query}" if query else "")


def _sign_in_redirect(request: Request) -> RedirectResponse:
    target = quote(_public_url(request), safe="")
    return RedirectResponse(
        f"{oauth_service.issuer()}/sign-in?redirect_url={target}",
        status_code=302,
        headers=NO_STORE,
    )


def _redirect_error(
    redirect_uri: str, error: str, description: str, state: str
) -> RedirectResponse:
    """Send an error back to a redirect URI that has already been proven to
    belong to the client that asked."""
    params = {"error": error, "error_description": description, "iss": oauth_service.issuer()}
    if state:
        params["state"] = state
    return RedirectResponse(
        oauth_service.redirect_to(redirect_uri, params), status_code=303, headers=NO_STORE
    )


def _allowed_resource(candidate: str, client: oauth_repo.OAuthClient) -> bool:
    allowed = [oauth_service.resource_identifier(), *client.resources]
    return any(oauth_service.constant_time_equals(candidate, value) for value in allowed)


def _workspace(user: Any) -> tuple[str, list[str]]:
    """(workspace id, roles) for a marketer.sh account.

    One account is one workspace: every niche, article, campaign and ledger
    row hangs off users.id, and the person who owns the account owns all of
    it. The id is prefixed so it is never confused with the subject id, and
    it is as stable as the user row itself.
    """
    roles = ["owner"]
    if getattr(user, "role", "user") == "admin":
        roles.append("platform_admin")
    return f"acct_{user.id}", roles


async def _workspace_label(user: Any) -> str:
    """Brand name when the account has a brand kit, else the email."""
    try:
        kit = await brand_kit_repo.get(user.id)
    except Exception:  # noqa: BLE001 - a missing brand kit must not break consent
        kit = None
    name = (getattr(kit, "brand_name", "") or "").strip()
    return name or user.email or f"acct_{user.id}"


@router.get("/oauth/authorize")
@limiter.limit("30/minute")
async def authorize(request: Request) -> Response:
    params = request.query_params

    # Step 1: the client and the redirect URI, before anything else. Until
    # both are known good there is no safe place to send an error.
    client = await oauth_repo.get_client(params.get("client_id", ""))
    if client is None or not client.is_active:
        return _error_page(
            "Unknown application",
            "The client_id in this link is not registered with marketer.sh, or has "
            "been disabled.",
        )

    redirect_uri = params.get("redirect_uri", "")
    if not oauth_service.matches_registered_redirect_uri(redirect_uri, client.redirect_uris):
        return _error_page(
            "Redirect address is not registered",
            "The redirect_uri in this link does not exactly match one registered for "
            f"{client.name}. It has not been used.",
        )

    # Step 2: everything else is the client's problem, and travels back to
    # the redirect URI it registered.
    state = params.get("state", "")

    if params.get("response_type", "") != "code":
        return _redirect_error(
            redirect_uri, "unsupported_response_type", "only response_type=code is supported", state
        )

    method = params.get("code_challenge_method", "")
    if method != oauth_service.CODE_CHALLENGE_METHOD:
        return _redirect_error(
            redirect_uri,
            "invalid_request",
            "code_challenge_method must be S256; plain PKCE is not accepted",
            state,
        )

    challenge = params.get("code_challenge", "")
    if not oauth_service.is_valid_code_challenge(challenge):
        return _redirect_error(
            redirect_uri, "invalid_request", "a valid S256 code_challenge is required", state
        )

    scopes = oauth_service.parse_scope(params.get("scope")) or list(client.scopes)
    unsupported = oauth_service.unsupported_scopes(scopes)
    if unsupported:
        return _redirect_error(
            redirect_uri, "invalid_scope", f"unknown scope: {' '.join(unsupported)}", state
        )
    ungranted = [s for s in scopes if s not in client.scopes]
    if ungranted:
        return _redirect_error(
            redirect_uri,
            "invalid_scope",
            f"this client is not registered for: {' '.join(ungranted)}",
            state,
        )

    resource = params.get("resource", "")
    if resource and not _allowed_resource(resource, client):
        return _redirect_error(
            redirect_uri, "invalid_target", "unknown resource indicator", state
        )

    # Step 3: the human. An unauthenticated visitor signs in and comes back
    # to this exact URL, query intact.
    ctx = await resolve_browser_session(request)
    if ctx is None:
        return _sign_in_redirect(request)

    user = await users_repo.get(ctx.user_id)
    if user is None:
        return _error_page(
            "Account not found",
            "Your marketer.sh account could not be loaded. Sign in again and retry.",
            status_code=401,
        )

    pending = await oauth_repo.create_authorization_request(
        user_id=user.id,
        client_id=client.client_id,
        redirect_uri=redirect_uri,
        scopes=scopes,
        state=state,
        code_challenge=challenge,
        code_challenge_method=method,
        resource=resource,
        expires_at=_now() + timedelta(seconds=oauth_service.code_ttl_seconds()),
    )

    return _consent_page(
        request_id=pending.id,
        client_name=client.name,
        workspace_label=await _workspace_label(user),
        subject_label=user.email or user.id,
        scopes=scopes,
        redirect_uri=redirect_uri,
    )


@router.post("/oauth/authorize")
@limiter.limit("30/minute")
async def authorize_decision(request: Request) -> Response:
    """The consent form posts here.

    Nothing about the authorization is read from the form: it carries only
    the id of the pending request and the decision. The row it names is
    bound to the user who started it and can be claimed once, which is what
    makes a cross-site POST useless.
    """
    form = await request.form()

    ctx = await resolve_browser_session(request)
    if ctx is None:
        return _error_page(
            "Session expired",
            "You were signed out before answering. Start the connection again.",
            status_code=401,
        )

    try:
        request_id = UUID(str(form.get("request_id", "")))
    except (ValueError, AttributeError):
        return _error_page("Invalid request", "This consent form is malformed.")

    pending = await oauth_repo.consume_authorization_request(request_id, ctx.user_id)
    if pending is None:
        return _error_page(
            "Consent request is no longer valid",
            "It expired or was already answered. Start the connection again.",
        )

    if str(form.get("decision", "")) != "approve":
        params = {"error": "access_denied", "iss": oauth_service.issuer()}
        if pending.state:
            params["state"] = pending.state
        return RedirectResponse(
            oauth_service.redirect_to(pending.redirect_uri, params),
            status_code=303,
            headers=NO_STORE,
        )

    grant = await oauth_repo.create_grant(
        user_id=pending.user_id,
        client_id=pending.client_id,
        scopes=pending.scopes,
        resource=pending.resource,
        redirect_uri=pending.redirect_uri,
    )
    code = oauth_service.new_authorization_code()
    await oauth_repo.create_authorization_code(
        code_hash=oauth_service.hash_secret(code),
        grant_id=grant.id,
        code_challenge=pending.code_challenge,
        code_challenge_method=pending.code_challenge_method,
        redirect_uri=pending.redirect_uri,
        resource=pending.resource,
        expires_at=_now() + timedelta(seconds=oauth_service.code_ttl_seconds()),
    )

    params = {"code": code, "iss": oauth_service.issuer()}
    if pending.state:
        params["state"] = pending.state
    return RedirectResponse(
        oauth_service.redirect_to(pending.redirect_uri, params),
        status_code=303,
        headers=NO_STORE,
    )


# ---------------------------------------------------------------------------
# Token endpoint
# ---------------------------------------------------------------------------


def _basic_credentials(request: Request) -> tuple[str, str]:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("basic "):
        return "", ""
    try:
        decoded = base64.b64decode(header.split(" ", 1)[1], validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, IndexError):
        return "", ""
    if ":" not in decoded:
        return "", ""
    client_id, secret = decoded.split(":", 1)
    return unquote(client_id), unquote(secret)


async def _authenticate_client(request: Request, form: Any) -> oauth_repo.OAuthClient:
    basic_id, basic_secret = _basic_credentials(request)
    client_id = basic_id or str(form.get("client_id", "") or "")
    if not client_id:
        raise OAuthProblem(400, {"error": "invalid_client", "error_description": "client_id is required"})

    client = await oauth_repo.get_client(client_id)
    if client is None or not client.is_active:
        raise OAuthProblem(
            401,
            {"error": "invalid_client", "error_description": "unknown or disabled client"},
            {"WWW-Authenticate": 'Basic realm="marketer.sh"'},
        )

    presented = basic_secret if basic_id else str(form.get("client_secret", "") or "")
    if client.is_confidential:
        if not oauth_service.secret_matches(presented, client.client_secret_hash or ""):
            raise OAuthProblem(
                401,
                {"error": "invalid_client", "error_description": "client authentication failed"},
                {"WWW-Authenticate": 'Basic realm="marketer.sh"'},
            )
    elif presented:
        # RFC 6749 §2.3: a public client has no secret, so a secret here means
        # the caller is not the client we registered.
        raise OAuthProblem(
            401,
            {
                "error": "invalid_client",
                "error_description": "this client is registered as public and must not send a secret",
            },
        )
    return client


async def _issue_token_set(grant: oauth_repo.Grant, scopes: list[str]) -> dict[str, Any]:
    now = _now()
    access = oauth_service.new_access_token()
    ttl = oauth_service.access_token_ttl_seconds()
    await oauth_repo.create_token(
        grant_id=grant.id,
        kind="access",
        token_hash=oauth_service.hash_secret(access),
        scopes=scopes,
        expires_at=now + timedelta(seconds=ttl),
    )
    body: dict[str, Any] = {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": ttl,
        "scope": oauth_service.format_scope(scopes),
    }
    # A refresh token is only issued when the user actually approved
    # offline_access. A client that wants one asks for the scope.
    if oauth_service.SCOPE_OFFLINE_ACCESS in scopes:
        refresh = oauth_service.new_refresh_token()
        await oauth_repo.create_token(
            grant_id=grant.id,
            kind="refresh",
            token_hash=oauth_service.hash_secret(refresh),
            scopes=scopes,
            expires_at=now + timedelta(seconds=oauth_service.refresh_token_ttl_seconds()),
        )
        body["refresh_token"] = refresh
    return body


@router.post("/oauth/token")
@limiter.limit("120/minute")
async def token(request: Request) -> Response:
    form = await request.form()
    client = await _authenticate_client(request, form)
    grant_type = str(form.get("grant_type", "") or "")

    if grant_type == "authorization_code":
        return await _exchange_authorization_code(form, client)
    if grant_type == "refresh_token":
        return await _exchange_refresh_token(form, client)
    return _error(
        400,
        "unsupported_grant_type",
        "supported grant types are authorization_code and refresh_token",
    )


async def _exchange_authorization_code(form: Any, client: oauth_repo.OAuthClient) -> Response:
    code_value = str(form.get("code", "") or "")
    verifier = str(form.get("code_verifier", "") or "")
    redirect_uri = str(form.get("redirect_uri", "") or "")

    if not code_value or not verifier or not redirect_uri:
        return _error(
            400,
            "invalid_request",
            "code, code_verifier and redirect_uri are all required",
        )

    outcome = await oauth_repo.consume_authorization_code(oauth_service.hash_secret(code_value))

    if outcome.status == "unknown":
        return _error(400, "invalid_grant", "unknown authorization code")

    code = outcome.code
    assert code is not None  # noqa: S101 - narrowed by the status check above

    if outcome.status == "replayed":
        # A code is single use. A second presentation means the first holder
        # is not the only holder: kill everything the grant ever issued.
        await oauth_repo.revoke_grant(code.grant_id, "authorization_code_replay")
        logger.warning("oauth.code_replay grant_id=%s client_id=%s", code.grant_id, client.client_id)
        return _error(
            400,
            "invalid_grant",
            "this authorization code was already used; the grant has been revoked",
            {"grant_revoked": True, "recovery_status": "authorization_code_replay_revoked"},
        )

    grant = await oauth_repo.get_grant(code.grant_id)
    if grant is None or not grant.is_live:
        return _error(400, "invalid_grant", "this grant has been revoked")

    if grant.client_id != client.client_id:
        # The code was issued to somebody else. Treat it as stolen.
        await oauth_repo.revoke_grant(grant.id, "authorization_code_wrong_client")
        logger.warning(
            "oauth.code_wrong_client grant_id=%s presented_by=%s", grant.id, client.client_id
        )
        return _error(400, "invalid_grant", "this code was not issued to this client")

    if _is_expired(code.expires_at):
        return _error(400, "invalid_grant", "this authorization code has expired")

    if not oauth_service.constant_time_equals(redirect_uri, code.redirect_uri):
        return _error(
            400, "invalid_grant", "redirect_uri does not match the one this code was issued for"
        )

    requested_resource = str(form.get("resource", "") or "")
    if requested_resource and not oauth_service.constant_time_equals(
        requested_resource, code.resource or oauth_service.resource_identifier()
    ):
        return _error(400, "invalid_target", "resource does not match this authorization")

    if code.code_challenge_method != oauth_service.CODE_CHALLENGE_METHOD:
        return _error(400, "invalid_grant", "unsupported code_challenge_method")

    if not oauth_service.verify_code_verifier(verifier, code.code_challenge):
        return _error(400, "invalid_grant", "PKCE verification failed")

    body = await _issue_token_set(grant, grant.scopes)
    return _json(body)


async def _exchange_refresh_token(form: Any, client: oauth_repo.OAuthClient) -> Response:
    presented = str(form.get("refresh_token", "") or "")
    if not presented:
        return _error(400, "invalid_request", "refresh_token is required")

    token_row = await oauth_repo.get_token_by_hash(oauth_service.hash_secret(presented))
    if token_row is None or token_row.kind != "refresh":
        return _error(400, "invalid_grant", "unknown refresh token")

    grant = await oauth_repo.get_grant(token_row.grant_id)
    if grant is None or grant.client_id != client.client_id:
        return _error(400, "invalid_grant", "unknown refresh token")

    if token_row.rotated_at is not None:
        # Rotation means this exact token was already exchanged. Its presence
        # here is theft, not a retry: revoke the family and say so.
        await oauth_repo.revoke_grant(grant.id, "refresh_token_replay")
        logger.warning("oauth.refresh_replay grant_id=%s client_id=%s", grant.id, client.client_id)
        return _error(
            400,
            "invalid_grant",
            "this refresh token was already rotated; the grant has been revoked",
            {
                "grant_revoked": True,
                "recovery_status": "refresh_token_replay_revoked",
                "scope": oauth_service.format_scope(grant.scopes),
            },
        )

    if not grant.is_live or token_row.revoked_at is not None:
        return _error(400, "invalid_grant", "this grant has been revoked")

    if _is_expired(token_row.expires_at):
        return _error(400, "invalid_grant", "this refresh token has expired")

    scopes = list(token_row.scopes)
    requested = oauth_service.parse_scope(str(form.get("scope", "") or ""))
    if requested:
        widened = [s for s in requested if s not in scopes]
        if widened:
            return _error(400, "invalid_scope", "a refresh cannot widen the granted scope")
        scopes = requested

    requested_resource = str(form.get("resource", "") or "")
    if requested_resource and not oauth_service.constant_time_equals(
        requested_resource, grant.resource or oauth_service.resource_identifier()
    ):
        return _error(400, "invalid_target", "resource does not match this grant")

    # Spend the old token in one statement, so two callers racing with the
    # same token cannot both be served.
    if not await oauth_repo.rotate_refresh_token(token_row.id):
        await oauth_repo.revoke_grant(grant.id, "refresh_token_replay")
        return _error(
            400,
            "invalid_grant",
            "this refresh token was already rotated; the grant has been revoked",
            {
                "grant_revoked": True,
                "recovery_status": "refresh_token_replay_revoked",
                "scope": oauth_service.format_scope(grant.scopes),
            },
        )

    # The access token issued alongside the spent refresh token dies with it.
    await oauth_repo.revoke_tokens_for_grant(grant.id, "access")

    body = await _issue_token_set(grant, scopes)
    return _json(body)


# ---------------------------------------------------------------------------
# Revocation (RFC 7009)
# ---------------------------------------------------------------------------


@router.post("/oauth/revoke")
@limiter.limit("120/minute")
async def revoke(request: Request) -> Response:
    """Always 200 with an empty body, whether or not the token existed.

    RFC 7009 §2.2: an unknown token is not an error, because telling a
    caller which strings are real tokens is an oracle. The one thing that
    does fail is client authentication, which the same section preserves.
    """
    form = await request.form()
    client = await _authenticate_client(request, form)

    presented = str(form.get("token", "") or "")
    if presented:
        token_row = await oauth_repo.get_token_by_hash(oauth_service.hash_secret(presented))
        if token_row is not None:
            grant = await oauth_repo.get_grant(token_row.grant_id)
            if grant is not None and grant.client_id == client.client_id:
                # "and everything issued alongside it": one grant, one family.
                await oauth_repo.revoke_grant(grant.id, "client_revocation")

    return Response(status_code=200, headers=NO_STORE)


# ---------------------------------------------------------------------------
# Userinfo
# ---------------------------------------------------------------------------


def _unauthorized(error: str, description: str) -> OAuthProblem:
    challenge = (
        f'Bearer error="{error}", error_description="{description}", '
        f'resource_metadata="{_resource_metadata_url()}"'
    )
    return OAuthProblem(
        401,
        {"error": error, "error_description": description},
        {"WWW-Authenticate": challenge},
    )


async def _bearer_grant(request: Request) -> tuple[oauth_repo.Token, oauth_repo.Grant]:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise OAuthProblem(
            401,
            {"error": "invalid_request", "error_description": "a bearer access token is required"},
            {"WWW-Authenticate": f'Bearer resource_metadata="{_resource_metadata_url()}"'},
        )

    token_row = await oauth_repo.get_token_by_hash(
        oauth_service.hash_secret(header.split(" ", 1)[1].strip())
    )
    if token_row is None or token_row.kind != "access":
        raise _unauthorized("invalid_token", "unknown access token")
    if token_row.revoked_at is not None:
        raise _unauthorized("invalid_token", "this access token has been revoked")
    if _is_expired(token_row.expires_at):
        raise _unauthorized("invalid_token", "this access token has expired")

    grant = await oauth_repo.get_grant(token_row.grant_id)
    if grant is None or not grant.is_live:
        raise _unauthorized("invalid_token", "this grant has been revoked")
    return token_row, grant


def _require_scope(token_row: oauth_repo.Token, scope: str) -> None:
    if scope in token_row.scopes:
        return
    raise OAuthProblem(
        403,
        {
            "error": "insufficient_scope",
            "error_description": f"this token does not carry the {scope} scope",
            "scope": scope,
        },
        {
            "WWW-Authenticate": (
                f'Bearer error="insufficient_scope", scope="{scope}", '
                f'resource_metadata="{_resource_metadata_url()}"'
            )
        },
    )


@router.get("/oauth/userinfo")
@limiter.limit("120/minute")
async def userinfo(request: Request) -> Response:
    """OIDC-style claims about the human behind the grant.

    No id_token is minted anywhere in this server (see services/oauth.py),
    so this endpoint is the only place those claims are served, and each
    group of them is gated on the scope that was actually approved.
    """
    token_row, grant = await _bearer_grant(request)
    _require_scope(token_row, oauth_service.SCOPE_OPENID)

    user = await users_repo.get(grant.user_id)
    if user is None:
        raise _unauthorized("invalid_token", "the account behind this grant no longer exists")

    claims: dict[str, Any] = {"sub": user.id, "scope": oauth_service.format_scope(token_row.scopes)}

    if oauth_service.SCOPE_PROFILE in token_row.scopes:
        org_id, roles = _workspace(user)
        label = await _workspace_label(user)
        claims.update(
            {
                "name": label,
                "preferred_username": (user.email or user.id).split("@")[0],
                "org_id": org_id,
                "org_name": label,
                "roles": roles,
            }
        )

    if oauth_service.SCOPE_EMAIL in token_row.scopes and user.email:
        # No email_verified claim: Clerk verifies the address, this app only
        # stores a copy of it, and asserting a verification we did not
        # perform is worse than omitting the claim.
        claims["email"] = user.email

    return _json(claims)
