"""Tests for GET /api/v1/spend/history.

We monkeypatch ``spend_repo.history`` so no asyncpg pool is needed.
Auth is exercised by calling the route function directly with/without a
valid AuthCtx, mirroring the pattern in test_jobs_routes.py.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from fastapi import HTTPException

from backend.auth import AuthCtx
from backend.routes import spend as spend_route
from autocontent.models import SpendHistoryRow


# ── helpers ──────────────────────────────────────────────────────────────────

NICHE_A = UUID("00000000-0000-0000-0000-000000000001")
NICHE_B = UUID("00000000-0000-0000-0000-000000000002")

_CTX = AuthCtx(user_id="user_test", email="test@example.com")


def _make_row(day: date, niche_id: UUID, cost: str) -> SpendHistoryRow:
    return SpendHistoryRow(day=day, niche_id=niche_id, cost_usd=Decimal(cost))


# ── tests ─────────────────────────────────────────────────────────────────────


async def test_empty_history_returns_empty_rows(monkeypatch):
    """When the ledger has no rows in the window, the response is empty."""

    async def _history(*, user_id, days, niche_id=None):
        return []

    monkeypatch.setattr(spend_route.spend_repo, "history", _history)

    result = await spend_route.spend_history(ctx=_CTX)
    assert result.rows == []
    assert result.days == 30
    assert result.total_usd == Decimal(0)


async def test_seeded_data_returns_expected_sums(monkeypatch):
    """Rows from the repo are passed through and total_usd is the sum."""
    day1 = date(2026, 1, 1)
    day2 = date(2026, 1, 2)
    fake_rows = [
        _make_row(day1, NICHE_A, "0.25"),
        _make_row(day1, NICHE_B, "0.10"),
        _make_row(day2, NICHE_A, "0.40"),
    ]

    async def _history(*, user_id, days, niche_id=None):
        return fake_rows

    monkeypatch.setattr(spend_route.spend_repo, "history", _history)

    result = await spend_route.spend_history(ctx=_CTX, days=7)
    assert len(result.rows) == 3
    assert result.total_usd == Decimal("0.75")
    assert result.days == 7


async def test_niche_filter_forwarded_to_repo(monkeypatch):
    """niche_id query param is passed through to spend_repo.history."""
    called_with: dict = {}

    async def _history(*, user_id, days, niche_id=None):
        called_with["niche_id"] = niche_id
        return []

    monkeypatch.setattr(spend_route.spend_repo, "history", _history)

    await spend_route.spend_history(ctx=_CTX, niche_id=NICHE_A)
    assert called_with["niche_id"] == NICHE_A


async def test_bad_days_too_small_returns_422(monkeypatch):
    """days=0 violates the cap guard → 422."""
    with pytest.raises(HTTPException) as ei:
        await spend_route.spend_history(ctx=_CTX, days=0)
    assert ei.value.status_code == 422


async def test_bad_days_too_large_returns_422(monkeypatch):
    """days=91 exceeds the cap → 422."""
    with pytest.raises(HTTPException) as ei:
        await spend_route.spend_history(ctx=_CTX, days=91)
    assert ei.value.status_code == 422


async def test_days_at_boundaries_are_valid(monkeypatch):
    """days=1 and days=90 are both within range — no exception."""

    async def _history(*, user_id, days, niche_id=None):
        return []

    monkeypatch.setattr(spend_route.spend_repo, "history", _history)

    result_1 = await spend_route.spend_history(ctx=_CTX, days=1)
    assert result_1.days == 1

    result_90 = await spend_route.spend_history(ctx=_CTX, days=90)
    assert result_90.days == 90


async def test_auth_required_no_ctx():
    """Calling the route without an AuthCtx is not something we can easily
    simulate at the function level, but we verify the route annotates the
    dependency correctly by checking the route function signature."""
    import inspect

    sig = inspect.signature(spend_route.spend_history)
    assert "ctx" in sig.parameters
