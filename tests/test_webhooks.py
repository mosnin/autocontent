"""Tests for the Ayrshare webhook receiver.

All tests go through the real HMAC path — no shimming past signature
verification (see brief requirement 4).
"""
from __future__ import annotations

import hashlib
import hmac
import json
from base64 import b64encode
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from marketer.models import Job, JobStatus

# ── Shared helpers ────────────────────────────────────────────────────────────

WEBHOOK_SECRET = "test-webhook-secret-abc123"
PROVIDER_POST_ID = "ayr-post-xyz"


def _make_sig(body: bytes, secret: str = WEBHOOK_SECRET) -> str:
    return b64encode(
        hmac.new(secret.encode(), body, hashlib.sha256).digest()
    ).decode()


def _post_webhook(client: TestClient, payload: dict[str, Any], *, secret: str = WEBHOOK_SECRET):
    body = json.dumps(payload).encode()
    return client.post(
        "/api/v1/webhooks/ayrshare",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-ayrshare-signature": _make_sig(body, secret),
        },
    )


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _set_secret(monkeypatch):
    """Ensure the webhook secret is set for all tests (can be overridden per-test)."""
    from marketer.config import settings
    monkeypatch.setattr(settings, "ayrshare_webhook_secret", WEBHOOK_SECRET)


@pytest.fixture()
def make_job() -> Job:
    """Return a minimal Job snapshot with a known provider_post_id."""
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
    """Create the FastAPI app with jobs_repo stubbed out.

    ``saved`` is a list that collects every Job passed to ``save_snapshot``
    so tests can assert on the persisted state.
    """
    saved: list[Job] = []

    async def _get_by_provider_post_id(post_id: str) -> Job | None:
        return make_job if post_id == PROVIDER_POST_ID else None

    async def _save_snapshot(job: Job) -> None:
        saved.append(job)

    import marketer.repos.jobs as jobs_repo

    monkeypatch.setattr(jobs_repo, "get_by_provider_post_id", _get_by_provider_post_id)
    monkeypatch.setattr(jobs_repo, "save_snapshot", _save_snapshot)

    from backend.main import create_app
    return create_app(), saved


@pytest.fixture()
def client(app):
    _app, saved = app
    return TestClient(_app), saved


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_success_event_marks_job_done(client):
    tc, saved = client
    resp = _post_webhook(tc, {"id": PROVIDER_POST_ID, "status": "success", "errors": []})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert len(saved) == 1
    assert saved[0].status == JobStatus.done
    assert saved[0].error is None


def test_errored_event_marks_job_failed(client):
    tc, saved = client
    payload = {
        "id": PROVIDER_POST_ID,
        "status": "errored",
        "errors": [{"message": "TikTok rejected the video"}],
    }
    resp = _post_webhook(tc, payload)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert len(saved) == 1
    job = saved[0]
    assert job.status == JobStatus.failed
    assert "TikTok rejected the video" in (job.error or "")


def test_deleted_event_does_not_mutate_job(client):
    tc, saved = client
    resp = _post_webhook(tc, {"id": PROVIDER_POST_ID, "status": "deleted", "errors": []})
    assert resp.status_code == 200
    # No save_snapshot call — status must not change.
    assert len(saved) == 0


def test_bad_signature_returns_401(client):
    tc, _saved = client
    body = json.dumps({"id": PROVIDER_POST_ID, "status": "success", "errors": []}).encode()
    resp = tc.post(
        "/api/v1/webhooks/ayrshare",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-ayrshare-signature": "not-a-valid-sig",
        },
    )
    assert resp.status_code == 401


def test_unknown_provider_post_id_returns_200(client):
    """Webhook for a job we don't have should be idempotent, not 404."""
    tc, saved = client
    resp = _post_webhook(tc, {"id": "unknown-post-id", "status": "success", "errors": []})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert len(saved) == 0  # nothing persisted


def test_missing_secret_returns_503(monkeypatch):
    """If the env var is unset the endpoint must refuse all deliveries."""
    from marketer.config import settings
    monkeypatch.setattr(settings, "ayrshare_webhook_secret", "")

    from backend.main import create_app
    tc = TestClient(create_app())

    body = json.dumps({"id": PROVIDER_POST_ID, "status": "success", "errors": []}).encode()
    resp = tc.post(
        "/api/v1/webhooks/ayrshare",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-ayrshare-signature": _make_sig(body),
        },
    )
    assert resp.status_code == 503


def test_alternate_signature_header_accepted(client):
    """``x-webhook-signature`` should be accepted as an alias."""
    tc, saved = client
    body = json.dumps({"id": PROVIDER_POST_ID, "status": "success", "errors": []}).encode()
    resp = tc.post(
        "/api/v1/webhooks/ayrshare",
        content=body,
        headers={
            "Content-Type": "application/json",
            "x-webhook-signature": _make_sig(body),
        },
    )
    assert resp.status_code == 200
    assert saved[0].status == JobStatus.done
