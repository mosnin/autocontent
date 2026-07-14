"""Tests for the Sentry integration wired into the JSON logger.

All tests use monkeypatch to reset module-level state between runs so
the idempotency checks are meaningful.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch


def _reset_logging_module():
    """Reset the module-level flags in marketer.logging so each test
    starts from a clean slate."""
    import marketer.logging as _logging_mod

    _logging_mod._configured = False
    _logging_mod._sentry_inited = False


def test_configure_with_empty_dsn_does_not_call_sentry_init(monkeypatch):
    """When sentry_dsn is empty, sentry_sdk.init must never be called."""
    from marketer.config import settings
    monkeypatch.setattr(settings, "sentry_dsn", "")
    _reset_logging_module()

    mock_sentry = MagicMock()
    with patch.dict("sys.modules", {"sentry_sdk": mock_sentry}):
        from marketer import logging as _logging_mod
        # Re-import to pick up the patched sys.modules path
        _logging_mod._configured = False
        _logging_mod._sentry_inited = False
        _logging_mod.configure()

    mock_sentry.init.assert_not_called()


def test_configure_with_dsn_calls_sentry_init_once(monkeypatch):
    """When sentry_dsn is set, sentry_sdk.init is called exactly once even
    if configure() is invoked multiple times."""
    from marketer.config import settings
    monkeypatch.setattr(settings, "sentry_dsn", "https://key@sentry.io/123")
    monkeypatch.setattr(settings, "sentry_environment", "test")
    monkeypatch.setattr(settings, "sentry_traces_sample_rate", 0.0)
    _reset_logging_module()

    mock_sentry = MagicMock()
    mock_logging_integration = MagicMock()
    mock_sentry.integrations.logging.LoggingIntegration = mock_logging_integration

    with patch.dict("sys.modules", {
        "sentry_sdk": mock_sentry,
        "sentry_sdk.integrations": mock_sentry.integrations,
        "sentry_sdk.integrations.logging": mock_sentry.integrations.logging,
    }):
        import marketer.logging as _logging_mod
        _logging_mod._configured = False
        _logging_mod._sentry_inited = False

        _logging_mod.configure()
        _logging_mod.configure()  # second call must be a no-op

    # init called exactly once regardless of how many times configure() runs
    assert mock_sentry.init.call_count == 1
    call_kwargs = mock_sentry.init.call_args[1]
    assert call_kwargs["dsn"] == "https://key@sentry.io/123"
    assert call_kwargs["environment"] == "test"


def test_fail_with_calls_capture_exception(monkeypatch):
    """_fail_with forwards failures to Sentry: capture_message when only a
    string is known, capture_exception when the exception object is passed."""
    from uuid import uuid4, UUID
    from marketer.models import Job, JobStatus
    from marketer.config import settings

    monkeypatch.setattr(settings, "sentry_dsn", "https://key@sentry.io/123")

    mock_sentry = MagicMock()

    # Build a minimal job
    job = Job(
        id=uuid4(),
        user_id="user_test",
        niche_id=UUID("00000000-0000-0000-0000-000000000001"),
        platform="tiktok",
        status=JobStatus.editing,
    )

    # Stub save_snapshot so we don't need a DB
    async def _noop(j: Job) -> None:
        pass

    import marketer.repos.jobs as jobs_repo
    monkeypatch.setattr(jobs_repo, "save_snapshot", _noop)

    import importlib

    with patch.dict("sys.modules", {"sentry_sdk": mock_sentry}):
        # Force pipeline to reload with the patched sentry_sdk
        import marketer.pipeline as pipeline_mod
        importlib.reload(pipeline_mod)

        import asyncio
        asyncio.run(pipeline_mod._fail_with(job, "test error"))
        # With an exception object, capture_exception is used instead.
        asyncio.run(pipeline_mod._fail_with(job, "boom", RuntimeError("boom")))

    assert mock_sentry.capture_message.called
    assert mock_sentry.capture_exception.called
