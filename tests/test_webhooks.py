"""Tests for the Zernio webhook receiver.

Every test goes through the real HMAC path — nothing shims past signature
verification, because the signature IS the auth on this endpoint.

Two routing paths are covered: post events reaching the job that produced
them, and account events reaching the user who owns the account. The second
is the multi-tenant one: an account bound to the wrong user would publish a
customer's content to someone else's socials.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus

# ── Shared helpers ────────────────────────────────────────────────────────────

WEBHOOK_SECRET = "test-webhook-secret-abc123"
PROVIDER_POST_ID = "post-xyz"
PROFILE_ID = "prof-abc"
ACCOUNT_ID = "acct-123"


def _make_sig(body: bytes, secret: str = WEBHOOK_SECRET) -> str:
    """Lowercase hex HMAC-SHA256 — Zernio's format, not base-64."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _post_webhook(
    client: TestClient,
    payload: dict[str, Any],
    *,
    secret: str = WEBHOOK_SECRET,
    header: str = "x-zernio-signature",
):
    body = json.dumps(payload).encode()
    return client.post(
        "/api/v1/webhooks/zernio",
        content=body,
        headers={
            "Content-Type": "application/json",
            header: _make_sig(body, secret),
        },
    )


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _set_secret(monkeypatch):
    from marketer.config import settings
    monkeypatch.setattr(settings, "zernio_webhook_secret", WEBHOOK_SECRET)


@pytest.fixture()
def make_job() -> Job:
    return Job(
        id=uuid4(),
        user_id="user_test",
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        platform="tiktok",
        status=JobStatus.scheduling,
        provider_post_id=PROVIDER_POST_ID,
    )


@pytest.fixture()
def app(monkeypatch, make_job):
    """The app with jobs_repo and social_accounts stubbed.

    ``saved`` collects every Job passed to save_snapshot; ``accounts``
    collects account writes, so tests can assert on persisted state.
    """
    saved: list[Job] = []
    accounts: list[dict] = []

    async def _get_by_provider_post_id(post_id: str) -> Job | None:
        return make_job if post_id == PROVIDER_POST_ID else None

    async def _save_snapshot(job: Job) -> None:
        saved.append(job)

    async def _upsert(**kwargs):
        accounts.append({"op": "upsert", **kwargs})
        return None

    async def _mark_disconnected(zernio_account_id: str):
        accounts.append({"op": "disconnect", "zernio_account_id": zernio_account_id})
        return object() if zernio_account_id == ACCOUNT_ID else None

    async def _id_by_zernio_profile(profile_id: str) -> str | None:
        return "user_test" if profile_id == PROFILE_ID else None

    import marketer.repos.jobs as jobs_repo
    import marketer.repos.social_accounts as accounts_repo
    import marketer.repos.users as users_repo

    monkeypatch.setattr(jobs_repo, "get_by_provider_post_id", _get_by_provider_post_id)
    monkeypatch.setattr(jobs_repo, "save_snapshot", _save_snapshot)
    monkeypatch.setattr(accounts_repo, "upsert", _upsert)
    monkeypatch.setattr(accounts_repo, "mark_disconnected", _mark_disconnected)
    monkeypatch.setattr(users_repo, "id_by_zernio_profile", _id_by_zernio_profile)

    from backend.main import create_app
    return create_app(), saved, accounts


@pytest.fixture()
def client(app):
    _app, saved, accounts = app
    return TestClient(_app), saved, accounts


# ── Signature ─────────────────────────────────────────────────────────────────


def test_bad_signature_returns_401(client):
    tc, _saved, _accounts = client
    body = json.dumps({"event": "post.published"}).encode()
    resp = tc.post(
        "/api/v1/webhooks/zernio",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-zernio-signature": "not-a-valid-sig",
        },
    )
    assert resp.status_code == 401


def test_legacy_signature_header_is_accepted(client):
    """Zernio still sends `X-Late-Signature` as an alias."""
    tc, saved, _accounts = client
    resp = _post_webhook(
        tc,
        {"event": "post.published", "post": {"_id": PROVIDER_POST_ID}},
        header="x-late-signature",
    )
    assert resp.status_code == 200
    assert saved[0].status == JobStatus.done


def test_missing_secret_returns_503(monkeypatch):
    """Unset secret must refuse every delivery rather than accept unsigned."""
    from marketer.config import settings
    monkeypatch.setattr(settings, "zernio_webhook_secret", "")

    from backend.main import create_app
    tc = TestClient(create_app())

    body = json.dumps({"event": "post.published"}).encode()
    resp = tc.post(
        "/api/v1/webhooks/zernio",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-zernio-signature": _make_sig(body),
        },
    )
    assert resp.status_code == 503


# ── Post events ───────────────────────────────────────────────────────────────


def test_published_event_marks_job_done(client):
    tc, saved, _accounts = client
    resp = _post_webhook(
        tc, {"event": "post.published", "post": {"_id": PROVIDER_POST_ID}}
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert len(saved) == 1
    assert saved[0].status == JobStatus.done
    assert saved[0].error is None


def test_failed_event_marks_job_failed_with_the_reason(client):
    tc, saved, _accounts = client
    resp = _post_webhook(tc, {
        "event": "post.failed",
        "post": {
            "_id": PROVIDER_POST_ID,
            "errors": [{"message": "TikTok rejected the video"}],
        },
    })
    assert resp.status_code == 200
    assert saved[0].status == JobStatus.failed
    assert "TikTok rejected the video" in (saved[0].error or "")


def test_redelivery_is_idempotent(client):
    """At-least-once delivery means the same event arrives twice. The
    transition is an assignment, so the second one is a no-op in effect."""
    tc, saved, _accounts = client
    payload = {"event": "post.published", "post": {"_id": PROVIDER_POST_ID}}
    assert _post_webhook(tc, payload).status_code == 200
    assert _post_webhook(tc, payload).status_code == 200
    assert {j.status for j in saved} == {JobStatus.done}


def test_unknown_post_id_returns_200(client):
    """A post we did not create, or a deleted job. Returning non-2xx would
    make the provider retry it forever."""
    tc, saved, _accounts = client
    resp = _post_webhook(tc, {"event": "post.published", "post": {"_id": "nope"}})
    assert resp.status_code == 200
    assert len(saved) == 0


def test_unhandled_post_event_does_not_mutate_the_job(client):
    tc, saved, _accounts = client
    resp = _post_webhook(
        tc, {"event": "post.scheduled", "post": {"_id": PROVIDER_POST_ID}}
    )
    assert resp.status_code == 200
    assert len(saved) == 0


# ── Account events ────────────────────────────────────────────────────────────


def test_account_connected_binds_the_account_to_its_owner(client):
    """This event is the only moment the provider hands us the
    accountId -> profileId mapping, so it is what makes publishing
    tenant-safe later."""
    tc, _saved, accounts = client
    resp = _post_webhook(tc, {
        "event": "account.connected",
        "account": {
            "accountId": ACCOUNT_ID,
            "profileId": PROFILE_ID,
            "platform": "instagram",
            "username": "acme",
        },
    })
    assert resp.status_code == 200
    assert len(accounts) == 1
    written = accounts[0]
    assert written["op"] == "upsert"
    assert written["user_id"] == "user_test"
    assert written["zernio_account_id"] == ACCOUNT_ID
    # The provider's platform name is normalized to ours on the way in.
    assert written["platform"] == "reels"


def test_account_for_an_unknown_profile_is_ignored(client):
    """Writing it under a guessed user is how one customer ends up
    publishing to another's socials."""
    tc, _saved, accounts = client
    resp = _post_webhook(tc, {
        "event": "account.connected",
        "account": {
            "accountId": ACCOUNT_ID,
            "profileId": "someone-elses-profile",
            "platform": "tiktok",
        },
    })
    assert resp.status_code == 200
    assert accounts == []


def test_account_on_a_platform_we_cannot_publish_to_is_ignored(client):
    tc, _saved, accounts = client
    resp = _post_webhook(tc, {
        "event": "account.connected",
        "account": {
            "accountId": ACCOUNT_ID,
            "profileId": PROFILE_ID,
            "platform": "pinterest",
        },
    })
    assert resp.status_code == 200
    assert accounts == []


def test_account_disconnected_marks_the_account_dead(client):
    tc, _saved, accounts = client
    resp = _post_webhook(tc, {
        "event": "account.disconnected",
        "account": {"accountId": ACCOUNT_ID, "profileId": PROFILE_ID},
    })
    assert resp.status_code == 200
    assert accounts == [{"op": "disconnect", "zernio_account_id": ACCOUNT_ID}]


def test_disconnect_for_an_unknown_account_returns_200(client):
    tc, _saved, _accounts = client
    resp = _post_webhook(tc, {
        "event": "account.disconnected",
        "account": {"accountId": "unknown", "profileId": PROFILE_ID},
    })
    assert resp.status_code == 200


# ── Malformed input ───────────────────────────────────────────────────────────


def test_malformed_body_returns_200_not_a_retry_loop(client):
    tc, saved, _accounts = client
    body = b"{not json"
    resp = tc.post(
        "/api/v1/webhooks/zernio",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-zernio-signature": _make_sig(body),
        },
    )
    assert resp.status_code == 200
    assert len(saved) == 0
