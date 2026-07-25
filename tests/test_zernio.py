"""Zernio publishing: the parts that are wrong silently if they are wrong.

Deliberately not HTTP-integration tests — those need a real key and would
publish to real socials. What is covered here is everything that can be
wrong *without raising*: a signature scheme that accepts the wrong
encoding, a 409 read as a failure instead of "already posted", an
idempotency key that changes between retries, a pending analytics sync
recorded as zero engagement.
"""
from __future__ import annotations

import hashlib
import hmac
from base64 import b64encode
from datetime import datetime, timezone
from uuid import UUID

import httpx
import pytest

from backend.routes.webhooks import _verify_zernio_signature
from marketer.services import publisher, zernio, zernio_analytics


# ── Webhook signature ────────────────────────────────────────────────────────

SECRET = "whsec-test"
BODY = b'{"event":"post.published","id":"evt_1"}'


def _hex_sig(body: bytes = BODY, secret: str = SECRET) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_signature_accepts_lowercase_hex():
    assert _verify_zernio_signature(BODY, _hex_sig(), SECRET)


def test_signature_is_case_insensitive_and_trims():
    assert _verify_zernio_signature(BODY, f"  {_hex_sig().upper()}\n", SECRET)


def test_signature_rejects_base64_encoding_of_the_same_digest():
    """Zernio signs with hex. Accepting a base-64 digest too would widen
    the verifier past the contract we actually checked against — same
    algorithm, different wire format, and only one of them is signed."""
    digest = hmac.new(SECRET.encode(), BODY, hashlib.sha256).digest()
    assert not _verify_zernio_signature(BODY, b64encode(digest).decode(), SECRET)


def test_signature_rejects_wrong_secret_and_tampered_body():
    assert not _verify_zernio_signature(BODY, _hex_sig(secret="other"), SECRET)
    assert not _verify_zernio_signature(b'{"event":"post.failed"}', _hex_sig(), SECRET)


def test_signature_rejects_missing_header():
    assert not _verify_zernio_signature(BODY, None, SECRET)
    assert not _verify_zernio_signature(BODY, "", SECRET)


# ── Post error mapping ───────────────────────────────────────────────────────


def _response(status_code: int, payload: dict) -> httpx.Response:
    return httpx.Response(
        status_code, json=payload, request=httpx.Request("POST", "https://zernio.com")
    )


def test_409_is_duplicate_carrying_the_existing_post_id():
    """A 24h content-hash rejection means the post already exists. Treating
    it as a failure would make a retry loop publish nothing and report an
    error for work that succeeded."""
    resp = _response(409, {
        "error": "already posted",
        "details": {"existingPostId": "post_abc", "platform": "tiktok"},
    })
    with pytest.raises(zernio.DuplicatePost) as exc:
        zernio._raise_for_post_error(resp)
    assert exc.value.existing_post_id == "post_abc"


def test_403_account_disconnected_is_its_own_type():
    """Retrying cannot fix a dead token — the user has to reconnect, and
    the caller needs to tell them so rather than back off and retry."""
    resp = _response(403, {"error": "disconnected", "code": "ACCOUNT_DISCONNECTED"})
    with pytest.raises(zernio.AccountDisconnected):
        zernio._raise_for_post_error(resp)


def test_403_without_code_is_a_plain_error_not_a_disconnect():
    resp = _response(403, {"error": "not your account"})
    with pytest.raises(zernio.ZernioError) as exc:
        zernio._raise_for_post_error(resp)
    assert not isinstance(exc.value, zernio.AccountDisconnected)


def test_success_status_raises_nothing():
    assert zernio._raise_for_post_error(_response(201, {"post": {"_id": "x"}})) is None


# ── Retry predicate ──────────────────────────────────────────────────────────


def _status_error(code: int) -> httpx.HTTPStatusError:
    return httpx.HTTPStatusError(
        "boom",
        request=httpx.Request("POST", "https://zernio.com"),
        response=httpx.Response(code),
    )


@pytest.mark.parametrize("code,retryable", [(429, True), (500, True), (503, True),
                                            (400, False), (401, False), (409, False)])
def test_only_transient_failures_retry(code: int, retryable: bool):
    """A deterministic 4xx will never succeed on retry; burning three
    attempts on it just delays the real error by ~20 seconds."""
    assert zernio._retryable(_status_error(code)) is retryable


def test_transport_errors_retry():
    assert zernio._retryable(httpx.ConnectTimeout("slow"))
    assert zernio._retryable(httpx.ConnectError("refused"))


# ── Caption + platform mapping ───────────────────────────────────────────────


def test_caption_joins_hashtags_and_normalizes_leading_hash():
    assert zernio.format_caption("Hi ", ["ai", "#video"]) == "Hi\n\n#ai #video"


def test_caption_without_hashtags_has_no_trailing_blank():
    assert zernio.format_caption(" Hello ", []) == "Hello"


def test_platform_map_covers_every_platform_we_publish_to():
    assert set(zernio.PLATFORM_MAP) == {"tiktok", "reels", "shorts"}
    assert zernio.PLATFORM_MAP["reels"] == "instagram"
    assert zernio.PLATFORM_MAP["shorts"] == "youtube"


# ── Idempotency key ──────────────────────────────────────────────────────────


def test_request_id_is_stable_for_the_same_work_item():
    """This is the whole point: a worker retry must produce the SAME key so
    Zernio returns the original post instead of publishing twice."""
    job_id = UUID("11111111-2222-3333-4444-555555555555")
    first = publisher._request_id("job", job_id, "tiktok")
    second = publisher._request_id("job", job_id, "tiktok")
    assert first == second


def test_request_id_differs_across_jobs_and_platforms():
    a = UUID("11111111-2222-3333-4444-555555555555")
    b = UUID("99999999-2222-3333-4444-555555555555")
    assert publisher._request_id("job", a, "tiktok") != publisher._request_id("job", b, "tiktok")
    assert publisher._request_id("job", a, "tiktok") != publisher._request_id("job", a, "reels")


# ── Enablement ───────────────────────────────────────────────────────────────


def test_enabled_follows_the_zernio_key(monkeypatch):
    monkeypatch.setattr(publisher.settings, "zernio_api_key", "")
    assert not publisher.enabled()
    monkeypatch.setattr(publisher.settings, "zernio_api_key", "set")
    assert publisher.enabled()


# ── Analytics normalization ──────────────────────────────────────────────────


def test_analytics_normalizes_to_our_internal_platform_names():
    out = zernio_analytics._normalize({
        "postId": "post_1",
        "platforms": [
            {"platform": "instagram", "metrics": {"views": 10, "likes": 2}},
            {"platform": "tiktok", "metrics": {"views": 99}},
        ],
    })
    assert out["id"] == "post_1"
    assert out["analytics"]["reels"] == {"views": 10, "likes": 2}
    assert out["analytics"]["tiktok"] == {"views": 99}


def test_analytics_drops_platforms_we_do_not_publish_to():
    """Storing metrics under a key the parser does not know is worse than
    dropping them: it looks like data and reads as nothing."""
    out = zernio_analytics._normalize({
        "postId": "p",
        "platforms": [{"platform": "pinterest", "metrics": {"views": 5}}],
    })
    assert out["analytics"] == {}


def test_analytics_tolerates_missing_metrics_block():
    out = zernio_analytics._normalize({"postId": "p", "platforms": [{"platform": "tiktok"}]})
    assert out["analytics"]["tiktok"] == {}


# ── Media guards ─────────────────────────────────────────────────────────────


def test_media_kind_from_content_type():
    assert zernio._media_kind("video/mp4") == "video"
    assert zernio._media_kind("image/png") == "image"


def test_unsupported_content_type_is_refused_before_upload(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("hi")
    with pytest.raises(zernio.ZernioError, match="does not accept"):
        zernio._content_type(path)


def test_iso_utc_normalizes_naive_datetimes_to_utc():
    naive = datetime(2026, 7, 24, 12, 0, 0)
    aware = datetime(2026, 7, 24, 12, 0, 0, tzinfo=timezone.utc)
    assert zernio._iso_utc(naive) == zernio._iso_utc(aware) == "2026-07-24T12:00:00Z"
