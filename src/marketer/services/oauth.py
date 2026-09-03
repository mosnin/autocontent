"""OAuth 2.1 authorization-server primitives.

Pure functions and constants only: no database, no FastAPI. The HTTP
surface lives in ``backend/routes/oauth.py`` and the persistence in
``marketer.repos.oauth``, so everything security-critical here (PKCE
verification, secret hashing, redirect-URI matching, scope parsing) can be
tested on its own.

Profile we implement, and the parts we deliberately do not
-----------------------------------------------------------
* Authorization code with PKCE ``S256`` only. ``plain`` is refused, and a
  code cannot be exchanged without a verifier: OAuth 2.1 makes PKCE
  mandatory for every client, not just public ones.
* Refresh tokens are rotated on every use and are single use.
* No implicit grant, no resource-owner password grant, no bearer token in a
  query string.
* ``openid`` and a userinfo endpoint, but no ``id_token``. Minting one means
  running a signing key and a JWKS endpoint; until that exists we would
  rather serve honest claims at /oauth/userinfo than a token we cannot
  rotate safely. Discovery therefore advertises the OAuth metadata document
  (RFC 8414) and not an OpenID provider configuration.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..config import settings

# ---------------------------------------------------------------------------
# Scopes
# ---------------------------------------------------------------------------

# scope -> the plain-words line the consent screen shows. A scope with no
# entry here does not exist: SUPPORTED_SCOPES is derived from these keys, so
# a scope can never be granted without a sentence explaining it to the human
# who is granting it.
SCOPE_DESCRIPTIONS: dict[str, str] = {
    "openid": "Confirm your identity (your marketer.sh user id).",
    "profile": "See your account name, workspace and role.",
    "email": "See the email address on your account.",
    "offline_access": "Stay connected in the background without asking you to sign in again.",
    "content:read": "Read the articles, videos and campaigns in your workspace.",
    "content:write": "Create and update articles, videos and campaigns in your workspace.",
}

SUPPORTED_SCOPES: tuple[str, ...] = tuple(SCOPE_DESCRIPTIONS)

# What a client gets when it registers without naming scopes. Read only, and
# without offline_access: a client that wants a refresh token has to ask.
DEFAULT_CLIENT_SCOPES: tuple[str, ...] = (
    "openid",
    "profile",
    "email",
    "offline_access",
    "content:read",
)

SCOPE_OPENID = "openid"
SCOPE_PROFILE = "profile"
SCOPE_EMAIL = "email"
SCOPE_OFFLINE_ACCESS = "offline_access"


def parse_scope(raw: str | None) -> list[str]:
    """Split a space-delimited scope string, preserving order, deduplicated."""
    if not raw:
        return []
    seen: list[str] = []
    for item in raw.split():
        if item not in seen:
            seen.append(item)
    return seen


def format_scope(scopes: list[str] | tuple[str, ...]) -> str:
    return " ".join(scopes)


def unsupported_scopes(scopes: list[str]) -> list[str]:
    return [s for s in scopes if s not in SCOPE_DESCRIPTIONS]


def describe_scopes(scopes: list[str]) -> list[tuple[str, str]]:
    """(scope, human sentence) pairs for the consent screen."""
    return [(s, SCOPE_DESCRIPTIONS[s]) for s in scopes if s in SCOPE_DESCRIPTIONS]


# ---------------------------------------------------------------------------
# PKCE
# ---------------------------------------------------------------------------

CODE_CHALLENGE_METHOD = "S256"

# RFC 7636: 43..128 characters from the unreserved set.
_VERIFIER_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")


def is_valid_code_verifier(verifier: str) -> bool:
    return bool(verifier) and _VERIFIER_RE.match(verifier) is not None


def is_valid_code_challenge(challenge: str) -> bool:
    return bool(challenge) and _CHALLENGE_RE.match(challenge) is not None


def code_challenge_for(verifier: str) -> str:
    """base64url(sha256(verifier)) with the padding stripped, per RFC 7636."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def verify_code_verifier(verifier: str, challenge: str) -> bool:
    """Constant-time PKCE check.

    ``hmac.compare_digest`` rather than ``==`` so the comparison cannot be
    turned into an oracle by timing how long a wrong prefix survives. An
    ill-formed verifier is refused before hashing.
    """
    if not is_valid_code_verifier(verifier) or not challenge:
        return False
    return hmac.compare_digest(code_challenge_for(verifier), challenge)


# ---------------------------------------------------------------------------
# Secrets: minted once, stored as sha256 hex, compared in constant time
# ---------------------------------------------------------------------------

CODE_PREFIX = "mko_ac_"
ACCESS_TOKEN_PREFIX = "mko_at_"
REFRESH_TOKEN_PREFIX = "mko_rt_"
CLIENT_ID_PREFIX = "mkoc_"
CLIENT_SECRET_PREFIX = "mkos_"

# 32 random bytes -> 43 base64url characters.
_ENTROPY_BYTES = 32


def _random(prefix: str) -> str:
    return f"{prefix}{secrets.token_urlsafe(_ENTROPY_BYTES)}"


def new_authorization_code() -> str:
    return _random(CODE_PREFIX)


def new_access_token() -> str:
    return _random(ACCESS_TOKEN_PREFIX)


def new_refresh_token() -> str:
    return _random(REFRESH_TOKEN_PREFIX)


def new_client_id() -> str:
    return f"{CLIENT_ID_PREFIX}{secrets.token_hex(12)}"


def new_client_secret() -> str:
    return _random(CLIENT_SECRET_PREFIX)


def hash_secret(value: str) -> str:
    """sha256 hex of a credential, the same shape personal access tokens use."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def secret_matches(presented: str, stored_hash: str) -> bool:
    if not presented or not stored_hash:
        return False
    return hmac.compare_digest(hash_secret(presented), stored_hash)


def constant_time_equals(left: str, right: str) -> bool:
    """Byte-for-byte equality without an early exit.

    Used for redirect URIs and resource indicators. They are not secrets,
    but they are attacker-supplied and matched against registered values, so
    there is no reason to leak how far a guess got.
    """
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def matches_registered_redirect_uri(candidate: str, registered: list[str]) -> bool:
    """Exact match against the registered list.

    No normalisation, no trailing-slash forgiveness, no prefix or wildcard
    matching, and no default when nothing matches. A redirect URI that is
    one byte different from the registered string is a different URI.
    """
    if not candidate:
        return False
    return any(constant_time_equals(candidate, uri) for uri in registered)


def is_registerable_redirect_uri(uri: str) -> bool:
    """Whether a URI may be REGISTERED (a stricter question than matching).

    https everywhere, except loopback http for local development. No
    fragment, which OAuth forbids on redirect URIs.
    """
    try:
        parts = urlsplit(uri)
    except ValueError:
        return False
    if parts.fragment or not parts.netloc:
        return False
    if parts.scheme == "https":
        return True
    host = parts.hostname or ""
    return parts.scheme == "http" and host in {"localhost", "127.0.0.1", "::1"}


def redirect_to(base: str, params: dict[str, str]) -> str:
    """Append query parameters to a redirect URI, keeping any it already has."""
    parts = urlsplit(base)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.extend((k, v) for k, v in params.items() if v is not None)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


# ---------------------------------------------------------------------------
# Deployment identity + discovery documents
# ---------------------------------------------------------------------------

_FALLBACK_ISSUER = "https://marketer.sh"


def issuer() -> str:
    """Public origin this authorization server identifies itself as."""
    for candidate in (settings.oauth_issuer, settings.app_url, _FALLBACK_ISSUER):
        value = (candidate or "").strip().rstrip("/")
        if value:
            return value
    return _FALLBACK_ISSUER


def resource_identifier() -> str:
    """RFC 8707 resource indicator for this deployment's API."""
    configured = (settings.oauth_resource or "").strip().rstrip("/")
    return configured or f"{issuer()}/api"


def endpoint(path: str) -> str:
    return f"{issuer()}{path}"


def authorization_server_metadata() -> dict:
    """RFC 8414 metadata, served at /.well-known/oauth-authorization-server."""
    return {
        "issuer": issuer(),
        "authorization_endpoint": endpoint("/oauth/authorize"),
        "token_endpoint": endpoint("/oauth/token"),
        "revocation_endpoint": endpoint("/oauth/revoke"),
        "userinfo_endpoint": endpoint("/oauth/userinfo"),
        "scopes_supported": list(SUPPORTED_SCOPES),
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": [CODE_CHALLENGE_METHOD],
        "token_endpoint_auth_methods_supported": [
            "none",
            "client_secret_basic",
            "client_secret_post",
        ],
        "revocation_endpoint_auth_methods_supported": [
            "none",
            "client_secret_basic",
            "client_secret_post",
        ],
        # RFC 9207: the authorization response carries `iss` so a client with
        # several authorization servers cannot be confused into sending a
        # code to the wrong one.
        "authorization_response_iss_parameter_supported": True,
        "resource_indicators_supported": True,
        "service_documentation": f"{issuer()}/docs/oauth",
        "ui_locales_supported": ["en-US"],
    }


def protected_resource_metadata() -> dict:
    """RFC 9728 metadata, served at /.well-known/oauth-protected-resource."""
    return {
        "resource": resource_identifier(),
        "authorization_servers": [issuer()],
        "scopes_supported": list(SUPPORTED_SCOPES),
        "bearer_methods_supported": ["header"],
        "resource_documentation": f"{issuer()}/docs/oauth",
    }


# ---------------------------------------------------------------------------
# Lifetimes
# ---------------------------------------------------------------------------


def access_token_ttl_seconds() -> int:
    # Clamped so a bad env var cannot mint a token that outlives the day.
    return max(60, min(int(settings.oauth_access_token_ttl_seconds), 86400))


def refresh_token_ttl_seconds() -> int:
    return max(600, int(settings.oauth_refresh_token_ttl_seconds))


def code_ttl_seconds() -> int:
    # RFC 6749 caps the recommended code lifetime at ten minutes.
    return max(30, min(int(settings.oauth_code_ttl_seconds), 600))
