"""Unit tests for the OAuth primitives that everything else is built on.

These are the pieces where a subtle mistake is invisible at the HTTP level:
the PKCE transform, the byte-for-byte URI match, scope parsing, and the
discovery documents.
"""
from __future__ import annotations

import pytest

from marketer.services import oauth


# --------------------------------------------------------------------------- PKCE

def test_code_challenge_matches_the_rfc_7636_test_vector() -> None:
    """Appendix B of RFC 7636. If this drifts, real clients stop working."""
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert oauth.code_challenge_for(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_verifier_length_bounds() -> None:
    assert oauth.is_valid_code_verifier("a" * 43)
    assert oauth.is_valid_code_verifier("a" * 128)
    assert not oauth.is_valid_code_verifier("a" * 42)
    assert not oauth.is_valid_code_verifier("a" * 129)
    assert not oauth.is_valid_code_verifier("")


def test_verifier_charset_is_the_unreserved_set() -> None:
    assert oauth.is_valid_code_verifier("-._~" + "a" * 40)
    assert not oauth.is_valid_code_verifier("!" + "a" * 42)
    assert not oauth.is_valid_code_verifier("a" * 42 + " ")


def test_verify_rejects_mismatch_and_malformed_input() -> None:
    verifier = "v" * 43
    challenge = oauth.code_challenge_for(verifier)
    assert oauth.verify_code_verifier(verifier, challenge)
    assert not oauth.verify_code_verifier("w" * 43, challenge)
    assert not oauth.verify_code_verifier("short", challenge)
    assert not oauth.verify_code_verifier(verifier, "")


# --------------------------------------------------------------------------- secrets

def test_secrets_are_only_ever_stored_hashed() -> None:
    secret = oauth.new_client_secret()
    stored = oauth.hash_secret(secret)
    assert secret not in stored
    assert len(stored) == 64
    assert oauth.secret_matches(secret, stored)
    assert not oauth.secret_matches(secret + "x", stored)
    assert not oauth.secret_matches("", stored)
    assert not oauth.secret_matches(secret, "")


def test_minted_values_are_distinct_and_prefixed() -> None:
    assert oauth.new_access_token().startswith(oauth.ACCESS_TOKEN_PREFIX)
    assert oauth.new_refresh_token().startswith(oauth.REFRESH_TOKEN_PREFIX)
    assert oauth.new_authorization_code().startswith(oauth.CODE_PREFIX)
    assert len({oauth.new_access_token() for _ in range(50)}) == 50


# --------------------------------------------------------------------------- redirect URIs

@pytest.mark.parametrize(
    "candidate",
    [
        "https://acme.example/cb/",     # trailing slash
        "https://acme.example/CB",      # case
        "https://acme.example/cb?x=1",  # extra query
        "https://acme.example:443/cb",  # explicit default port
        "http://acme.example/cb",       # scheme
        " https://acme.example/cb",     # whitespace
        "",
    ],
)
def test_registered_redirect_uri_match_is_exact(candidate: str) -> None:
    registered = ["https://acme.example/cb"]
    assert not oauth.matches_registered_redirect_uri(candidate, registered)


def test_registered_redirect_uri_match_accepts_the_exact_string() -> None:
    registered = ["https://other.example/cb", "https://acme.example/cb"]
    assert oauth.matches_registered_redirect_uri("https://acme.example/cb", registered)


@pytest.mark.parametrize(
    ("uri", "ok"),
    [
        ("https://acme.example/cb", True),
        ("http://localhost:3000/cb", True),
        ("http://127.0.0.1:3000/cb", True),
        ("http://acme.example/cb", False),
        ("https://acme.example/cb#fragment", False),
        ("acme://callback", False),
        ("not a url", False),
    ],
)
def test_registerable_redirect_uri_policy(uri: str, ok: bool) -> None:
    assert oauth.is_registerable_redirect_uri(uri) is ok


def test_redirect_to_preserves_existing_query() -> None:
    url = oauth.redirect_to("https://acme.example/cb?tenant=42", {"code": "abc", "state": "s/1"})
    assert url.startswith("https://acme.example/cb?tenant=42&")
    assert "code=abc" in url
    assert "state=s%2F1" in url


# --------------------------------------------------------------------------- scopes

def test_scope_parsing_is_order_preserving_and_deduplicated() -> None:
    assert oauth.parse_scope("openid profile openid  email") == ["openid", "profile", "email"]
    assert oauth.parse_scope("") == []
    assert oauth.parse_scope(None) == []
    assert oauth.format_scope(["openid", "email"]) == "openid email"


def test_every_supported_scope_has_a_sentence_for_the_consent_screen() -> None:
    assert set(oauth.SUPPORTED_SCOPES) == set(oauth.SCOPE_DESCRIPTIONS)
    for scope in oauth.SUPPORTED_SCOPES:
        assert oauth.SCOPE_DESCRIPTIONS[scope].strip().endswith(".")
    assert oauth.unsupported_scopes(["openid", "admin:everything"]) == ["admin:everything"]


def test_default_client_scopes_are_all_supported() -> None:
    assert not oauth.unsupported_scopes(list(oauth.DEFAULT_CLIENT_SCOPES))


# --------------------------------------------------------------------------- deployment identity

def test_issuer_falls_back_from_oauth_issuer_to_app_url(monkeypatch) -> None:
    from marketer.config import settings

    monkeypatch.setattr(settings, "oauth_issuer", "https://marketer.sh/")
    assert oauth.issuer() == "https://marketer.sh"

    monkeypatch.setattr(settings, "oauth_issuer", "")
    monkeypatch.setattr(settings, "app_url", "https://app.marketer.dev")
    assert oauth.issuer() == "https://app.marketer.dev"
    assert oauth.resource_identifier() == "https://app.marketer.dev/api"


def test_metadata_documents_are_self_consistent(monkeypatch) -> None:
    from marketer.config import settings

    monkeypatch.setattr(settings, "oauth_issuer", "https://marketer.sh")
    monkeypatch.setattr(settings, "oauth_resource", "")

    meta = oauth.authorization_server_metadata()
    for key in ("authorization_endpoint", "token_endpoint", "revocation_endpoint"):
        assert meta[key].startswith(meta["issuer"] + "/oauth/")
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert "implicit" not in meta["grant_types_supported"]
    assert "token" not in meta["response_types_supported"]

    resource = oauth.protected_resource_metadata()
    assert resource["authorization_servers"] == [meta["issuer"]]
    assert resource["bearer_methods_supported"] == ["header"]


def test_token_lifetimes_are_clamped(monkeypatch) -> None:
    from marketer.config import settings

    monkeypatch.setattr(settings, "oauth_access_token_ttl_seconds", 999999)
    assert oauth.access_token_ttl_seconds() == 86400
    monkeypatch.setattr(settings, "oauth_access_token_ttl_seconds", 1)
    assert oauth.access_token_ttl_seconds() == 60

    monkeypatch.setattr(settings, "oauth_code_ttl_seconds", 3600)
    assert oauth.code_ttl_seconds() == 600  # RFC 6749: ten minutes, no longer
