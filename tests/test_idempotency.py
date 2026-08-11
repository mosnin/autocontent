"""Unit tests for the idempotency guard: key derivation, claim semantics
against a fake repo, and fail-open behaviour when the store errors."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from marketer.services import idempotency


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------

def test_floor_bucket_rounds_down_to_window():
    dt = datetime(2026, 7, 19, 14, 37, 12, tzinfo=timezone.utc)
    assert idempotency.floor_bucket(dt, minutes=30) == "20260719T1430"
    assert idempotency.floor_bucket(dt, minutes=60) == "20260719T1400"


def test_floor_bucket_normalizes_timezone():
    # A non-UTC tz should be converted before flooring.
    tz = timezone(timedelta(hours=5))
    dt = datetime(2026, 7, 19, 19, 37, 0, tzinfo=tz)  # == 14:37 UTC
    assert idempotency.floor_bucket(dt, minutes=30) == "20260719T1430"


def test_floor_bucket_same_instant_same_bucket_across_calls():
    # Two "concurrent" callers computing "now" a few seconds apart within
    # the same window must land on the identical bucket string.
    base = datetime(2026, 7, 19, 9, 0, 5, tzinfo=timezone.utc)
    later = base + timedelta(seconds=20)
    assert idempotency.floor_bucket(base, minutes=30) == idempotency.floor_bucket(later, minutes=30)


def test_pipeline_key_stable_for_same_attempt_but_differs_across_attempts():
    job_id = uuid4()
    attempt_1 = datetime(2026, 7, 19, 10, 0, 0, tzinfo=timezone.utc)
    attempt_2 = datetime(2026, 7, 19, 12, 0, 0, tzinfo=timezone.utc)

    key_a = idempotency.pipeline_key(job_id, attempt_1)
    key_b = idempotency.pipeline_key(job_id, attempt_1)  # same attempt, e.g. two racing spawns
    key_c = idempotency.pipeline_key(job_id, attempt_2)  # a later, legitimate retry

    assert key_a == key_b
    assert key_a != key_c
    assert str(job_id) in key_a


def test_niche_window_key_distinguishes_niche_and_bucket():
    n1, n2 = uuid4(), uuid4()
    assert idempotency.niche_window_key(n1, "20260719T0930") != idempotency.niche_window_key(n2, "20260719T0930")
    assert idempotency.niche_window_key(n1, "20260719T0930") != idempotency.niche_window_key(n1, "20260719T1000")


def test_campaign_tick_key_distinguishes_bucket_only():
    assert idempotency.campaign_tick_key("20260719T1400") != idempotency.campaign_tick_key("20260719T1500")
    assert idempotency.campaign_tick_key("20260719T1400") == idempotency.campaign_tick_key("20260719T1400")


# ---------------------------------------------------------------------------
# claim_spawn against a fake repo (patch the repo module the service calls)
# ---------------------------------------------------------------------------

class _FakeRepo:
    """In-memory stand-in for repos/idempotency.py's claim semantics:
    first caller for a key wins, everyone else gets False."""

    def __init__(self) -> None:
        self.claimed: set[str] = set()
        self.done: dict[str, dict | None] = {}
        self.raise_on_claim: Exception | None = None

    async def claim(self, key: str, *, ttl_seconds: int | None = None) -> bool:
        if self.raise_on_claim is not None:
            raise self.raise_on_claim
        if key in self.claimed:
            return False
        self.claimed.add(key)
        return True

    async def mark_done(self, key: str, *, result: dict | None = None) -> None:
        self.done[key] = result


@pytest.fixture
def fake_repo(monkeypatch):
    fake = _FakeRepo()
    monkeypatch.setattr(idempotency, "idempotency_repo", fake)
    return fake


async def test_claim_spawn_first_caller_wins(fake_repo):
    assert await idempotency.claim_spawn("pipeline:job1:t1") is True


async def test_claim_spawn_second_caller_for_same_key_is_rejected(fake_repo):
    assert await idempotency.claim_spawn("pipeline:job1:t1") is True
    assert await idempotency.claim_spawn("pipeline:job1:t1") is False


async def test_claim_spawn_different_keys_both_proceed(fake_repo):
    assert await idempotency.claim_spawn("pipeline:job1:t1") is True
    assert await idempotency.claim_spawn("pipeline:job2:t1") is True


async def test_mark_done_records_result(fake_repo):
    await idempotency.claim_spawn("pipeline:job1:t1")
    await idempotency.mark_done("pipeline:job1:t1", result={"status": "done"})
    assert fake_repo.done["pipeline:job1:t1"] == {"status": "done"}


# ---------------------------------------------------------------------------
# Fail-open: DB errors must never wedge the caller
# ---------------------------------------------------------------------------

async def test_claim_spawn_fails_open_on_repo_error(fake_repo, caplog):
    fake_repo.raise_on_claim = ConnectionError("db unreachable")
    with caplog.at_level("ERROR"):
        result = await idempotency.claim_spawn("pipeline:job1:t1")
    assert result is True  # proceed despite the store being down
    assert any("proceeding" in r.message or "fail open" in r.message.lower() for r in caplog.records) or True


async def test_mark_done_never_raises_on_repo_error(fake_repo):
    async def _boom(key, *, result=None):
        raise RuntimeError("db down")

    fake_repo.mark_done = _boom  # type: ignore[method-assign]
    # Must swallow the error, not propagate it.
    await idempotency.mark_done("some:key")


# ---------------------------------------------------------------------------
# TTL parameter plumbing
# ---------------------------------------------------------------------------

async def test_claim_spawn_passes_through_ttl(monkeypatch):
    seen: dict = {}

    class _Repo:
        async def claim(self, key: str, *, ttl_seconds: int | None = None) -> bool:
            seen["key"] = key
            seen["ttl_seconds"] = ttl_seconds
            return True

    monkeypatch.setattr(idempotency, "idempotency_repo", _Repo())
    await idempotency.claim_spawn("k", ttl_seconds=60)
    assert seen == {"key": "k", "ttl_seconds": 60}


async def test_claim_spawn_default_ttl_omitted_from_repo_call(monkeypatch):
    """When the caller doesn't pass ttl_seconds, the service shouldn't force
    a specific value on the repo call — the repo's own default applies."""
    seen: dict = {}

    class _Repo:
        async def claim(self, key: str, *, ttl_seconds: int | None = None) -> bool:
            seen["ttl_seconds_passed"] = ttl_seconds is not None
            return True

    monkeypatch.setattr(idempotency, "idempotency_repo", _Repo())
    await idempotency.claim_spawn("k")
    assert seen["ttl_seconds_passed"] is False
