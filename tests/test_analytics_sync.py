"""Tests for the daily_analytics_sync Modal function.

The sync logic is extracted from modal_app.py and exercised here by
monkeypatching the DB pool, Ayrshare client, and post_metrics repo.
No real DB or HTTP calls.
"""
from __future__ import annotations

import sys
import types
from uuid import uuid4

import pytest

# ── Stub out modal before importing modal_app ─────────────────────────────────


@pytest.fixture(autouse=True)
def _stub_modal(monkeypatch):
    """Replace the `modal` package with a thin stub so modal_app.py imports
    without hitting any Modal infra."""
    fake_modal = types.ModuleType("modal")

    class _FakeApp:
        def __init__(self, *a, **kw): pass
        def function(self, *a, **kw):
            def _decorator(fn):
                return fn
            return _decorator
        def local_entrypoint(self):
            def _decorator(fn):
                return fn
            return _decorator

    class _FakeVolume:
        @staticmethod
        def from_name(*a, **kw): return _FakeVolume()
        def commit(self): pass

    class _FakeSecret:
        @staticmethod
        def from_name(*a, **kw): return _FakeSecret()

    class _FakeCron:
        def __init__(self, *a, **kw): pass

    class _FakeImage:
        def debian_slim(self, *a, **kw): return self
        def apt_install(self, *a, **kw): return self
        def pip_install_from_pyproject(self, *a, **kw): return self
        def add_local_python_source(self, *a, **kw): return self

    fake_modal.App = _FakeApp
    fake_modal.Volume = _FakeVolume
    fake_modal.Secret = _FakeSecret
    fake_modal.Cron = _FakeCron
    fake_modal.Image = _FakeImage()
    fake_modal.asgi_app = lambda *a, **kw: (lambda fn: fn)

    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    yield


# ── Import the sync function after modal is stubbed ───────────────────────────

@pytest.fixture
def sync_fn():
    """Import + return daily_analytics_sync with a fresh module state."""
    # Remove cached copy if present so we get a clean import
    sys.modules.pop("modal_app", None)
    import modal_app  # noqa: PLC0415
    return modal_app.daily_analytics_sync


# ── Helpers ───────────────────────────────────────────────────────────────────

class _FakePool:
    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, query: str, *args):
        return self._rows


def _make_row(*, provider_post_id: str = "ayr-1", platform: str = "tiktok") -> dict:
    return {
        "id": uuid4(),
        "user_id": "user_test",
        "platform": platform,
        "provider_post_id": provider_post_id,
    }


SAMPLE_RAW = {
    "id": "ayr-1",
    "analytics": {
        "tiktok": {
            "views": 500,
            "likes": 20,
            "completionRate": 0.35,
        }
    },
}


# ── Tests ─────────────────────────────────────────────────────────────────────

async def test_one_record_per_eligible_job(sync_fn, monkeypatch):
    """One fetch + one record() call per job row returned by the DB."""
    rows = [_make_row(provider_post_id="ayr-1"), _make_row(provider_post_id="ayr-2")]
    pool = _FakePool(rows)

    recorded = []

    async def _fake_get_pool():
        return pool

    async def _fake_fetch(provider_post_id: str, platforms: list[str]) -> dict:
        return {**SAMPLE_RAW, "id": provider_post_id}

    async def _fake_record(metrics):
        recorded.append(metrics)
        return metrics

    import marketer.db as db_mod
    import marketer.repos.post_metrics as pm_repo
    import marketer.services.ayrshare_analytics as analytics_mod

    monkeypatch.setattr(db_mod, "get_pool", _fake_get_pool)
    monkeypatch.setattr(analytics_mod, "fetch_post_analytics", _fake_fetch)
    monkeypatch.setattr(pm_repo, "record", _fake_record)

    result = await sync_fn()

    assert result["synced"] == 2
    assert result["errors"] == 0
    assert len(recorded) == 2


async def test_one_bad_fetch_does_not_kill_loop(sync_fn, monkeypatch):
    """An exception in one fetch is logged and swallowed; other jobs still run."""
    rows = [_make_row(provider_post_id="ayr-ok"), _make_row(provider_post_id="ayr-bad")]
    pool = _FakePool(rows)

    recorded = []

    async def _fake_get_pool():
        return pool

    async def _fake_fetch(provider_post_id: str, platforms: list[str]) -> dict:
        if provider_post_id == "ayr-bad":
            from marketer.services.ayrshare_analytics import AyrshareAnalyticsError
            raise AyrshareAnalyticsError("simulated 429")
        return {**SAMPLE_RAW, "id": provider_post_id}

    async def _fake_record(metrics):
        recorded.append(metrics)
        return metrics

    import marketer.db as db_mod
    import marketer.repos.post_metrics as pm_repo
    import marketer.services.ayrshare_analytics as analytics_mod

    monkeypatch.setattr(db_mod, "get_pool", _fake_get_pool)
    monkeypatch.setattr(analytics_mod, "fetch_post_analytics", _fake_fetch)
    monkeypatch.setattr(pm_repo, "record", _fake_record)

    result = await sync_fn()

    assert result["synced"] == 1
    assert result["errors"] == 1
    assert result["total"] == 2
    assert len(recorded) == 1


async def test_empty_job_list_returns_zero_counts(sync_fn, monkeypatch):
    """No eligible jobs → synced=0, errors=0."""
    pool = _FakePool([])

    async def _fake_get_pool():
        return pool

    import marketer.db as db_mod
    monkeypatch.setattr(db_mod, "get_pool", _fake_get_pool)

    result = await sync_fn()

    assert result == {"synced": 0, "errors": 0, "total": 0}
