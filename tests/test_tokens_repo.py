"""Pure-function coverage for the token repo.

We don't have a live Postgres in CI, so we test the hashing / prefix /
plaintext-format helpers directly. The repo's create/list/get/revoke
wrappers are thin asyncpg calls — covered by integration deploys.
"""
from __future__ import annotations

import hashlib

import pytest

from autocontent.repos import tokens as tokens_repo


def test_generate_plaintext_shape():
    tok = tokens_repo.generate_plaintext()
    assert tok.startswith("act_")
    body = tok[len("act_"):]
    assert len(body) == tokens_repo.TOKEN_BODY_LEN
    # base32 lowercase alphabet
    allowed = set("abcdefghijklmnopqrstuvwxyz234567")
    assert set(body).issubset(allowed)


def test_generate_plaintext_is_random():
    tokens = {tokens_repo.generate_plaintext() for _ in range(200)}
    assert len(tokens) == 200  # no collisions across 200 draws


def test_hash_token_is_sha256_hex():
    plaintext = "act_abcdefghijklmnopqrstuvwx"
    expected = hashlib.sha256(plaintext.encode()).hexdigest()
    assert tokens_repo.hash_token(plaintext) == expected
    assert len(tokens_repo.hash_token(plaintext)) == 64


def test_display_prefix_extracts_short_hint():
    plaintext = "act_abcdefghijklmnopqrstuvwx"
    assert tokens_repo.display_prefix(plaintext) == "act_abcd"


def test_display_prefix_rejects_foreign_format():
    with pytest.raises(ValueError):
        tokens_repo.display_prefix("ghp_notours")


def test_compute_expires_at_none_passthrough():
    assert tokens_repo.compute_expires_at(None) is None


def test_compute_expires_at_returns_future():
    from datetime import datetime, timezone
    out = tokens_repo.compute_expires_at(30)
    assert out is not None
    assert out > datetime.now(timezone.utc)


def test_roundtrip_hash_matches_generated():
    """A freshly generated token must hash to a value we'd lookup later."""
    plaintext = tokens_repo.generate_plaintext()
    h1 = tokens_repo.hash_token(plaintext)
    h2 = tokens_repo.hash_token(plaintext)
    assert h1 == h2
