"""Admin kill-switches: missing flag allows; explicit false denies."""
from __future__ import annotations

from marketer.repos import feature_flags as flags_repo
from backend.hosted_safety import refuse_if_flag_off

from fastapi import HTTPException


async def test_allowed_true_when_row_missing(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            return None

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("generate") is True


async def test_allowed_false_when_disabled(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            return False

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("publish") is False


async def test_refuse_if_flag_off_403(monkeypatch):
    async def _allowed(key):
        return key != "billing"

    monkeypatch.setattr(flags_repo, "allowed", _allowed)
    await refuse_if_flag_off("generate")
    try:
        await refuse_if_flag_off("billing")
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("expected 403")


async def test_allowed_true_when_explicitly_enabled(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            return True

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("generate") is True


async def test_allowed_fail_open_when_pool_raises(monkeypatch):
    """A missing table / unreachable DB must not freeze generate or publish."""

    async def _pool():
        raise RuntimeError("no pool")

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("publish") is True


async def test_allowed_fail_open_when_fetch_raises(monkeypatch):
    class _Pool:
        async def fetchval(self, sql, *args):
            raise RuntimeError("relation feature_flags does not exist")

    async def _pool():
        return _Pool()

    monkeypatch.setattr(flags_repo, "get_pool", _pool)
    assert await flags_repo.allowed("generate") is True


async def test_generate_flag_off_helper_matches_admin_row(monkeypatch):
    """Posting-window cron reads the same kill-switch as HTTP / campaign."""
    from modal_app import _generate_flag_off

    async def _denied(key):
        assert key == "generate"
        return False

    monkeypatch.setattr(flags_repo, "allowed", _denied)
    assert await _generate_flag_off() is True

    async def _allowed(key):
        assert key == "generate"
        return True

    monkeypatch.setattr(flags_repo, "allowed", _allowed)
    assert await _generate_flag_off() is False


def _raw_modal(fn):
    raw = getattr(fn, "get_raw_f", None)
    if callable(raw):
        return raw()
    info = getattr(fn, "info", None)
    if info is not None and getattr(info, "raw_f", None) is not None:
        return info.raw_f
    wrapped = getattr(fn, "__wrapped__", None)
    if wrapped is not None:
        return wrapped
    return fn


async def test_nightly_batch_skips_before_user_scan_when_generate_off(monkeypatch):
    """Admin disable must not walk users or spawn run_niche_window."""
    import modal_app

    async def _denied(key):
        assert key == "generate"
        return False

    monkeypatch.setattr(flags_repo, "allowed", _denied)

    nightly = _raw_modal(modal_app.nightly_batch)
    result = await nightly()
    assert result["spawned"] == 0
    assert result["skipped_generate_disabled"] is True


async def test_run_niche_window_skips_before_run_job_when_generate_off(monkeypatch):
    """Leftover niche-window invokes must not buy a video after disable."""
    import modal_app

    async def _denied(key):
        assert key == "generate"
        return False

    monkeypatch.setattr(flags_repo, "allowed", _denied)

    window = _raw_modal(modal_app.run_niche_window)
    result = await window("user_a", "11111111-1111-1111-1111-111111111111", ["tiktok"])
    assert result == [
        {
            "status": "skipped_generate_disabled",
            "niche_id": "11111111-1111-1111-1111-111111111111",
        }
    ]
