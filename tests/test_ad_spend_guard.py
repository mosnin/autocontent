"""AdSpendGuard is the fail-CLOSED gate on ad spend, so its logic is tested
exhaustively. Pure functions — no DB, no mocks."""
from __future__ import annotations

from decimal import Decimal

from marketer.services.ad_spend_guard import (
    AccountGovernance,
    evaluate_budget_change,
    evaluate_non_budget_action,
)

_THRESHOLD = Decimal("50")


def _acct(
    *, status="active", killswitch=False, daily_cap=None, monthly_cap=None
) -> AccountGovernance:
    return AccountGovernance(
        status=status,
        killswitch=killswitch,
        daily_cap_usd=daily_cap,
        monthly_cap_usd=monthly_cap,
    )


def _budget(**kw):
    base = dict(
        account=_acct(),
        committed_daily_budget_usd=Decimal("0"),
        new_daily_budget_usd=Decimal("10"),
        today_spend_usd=Decimal("0"),
        month_spend_usd=Decimal("0"),
        dollar_delta_usd=Decimal("10"),
        approval_threshold_usd=_THRESHOLD,
    )
    base.update(kw)
    return evaluate_budget_change(**base)


# --------------------------------------------------------------------------- deny paths

def test_denies_without_account():
    d = _budget(account=None)
    assert not d.allowed and "no connected" in d.reason


def test_denies_inactive_account():
    d = _budget(account=_acct(status="pending"))
    assert not d.allowed and "not active" in d.reason


def test_killswitch_denies_growth_but_allows_winddown():
    killed = _acct(killswitch=True)
    # Growth blocked.
    grow = _budget(account=killed, new_daily_budget_usd=Decimal("20"),
                   dollar_delta_usd=Decimal("20"))
    assert not grow.allowed and "kill-switch" in grow.reason
    # Winding down to zero is allowed even while killed.
    down = _budget(account=killed, new_daily_budget_usd=Decimal("0"),
                   dollar_delta_usd=Decimal("-10"))
    assert down.allowed


def test_denies_negative_budget():
    d = _budget(new_daily_budget_usd=Decimal("-1"), dollar_delta_usd=Decimal("-11"))
    assert not d.allowed and "negative" in d.reason


def test_denies_when_projected_exceeds_daily_cap():
    # $30 already committed on other campaigns + $25 new = $55 > $50 cap.
    d = _budget(
        account=_acct(daily_cap=Decimal("50")),
        committed_daily_budget_usd=Decimal("30"),
        new_daily_budget_usd=Decimal("25"),
        dollar_delta_usd=Decimal("25"),
    )
    assert not d.allowed and "daily cap" in d.reason


def test_denies_when_today_spend_at_cap():
    d = _budget(
        account=_acct(daily_cap=Decimal("50")),
        today_spend_usd=Decimal("50"),
        new_daily_budget_usd=Decimal("1"),
        dollar_delta_usd=Decimal("1"),
    )
    assert not d.allowed and "already reached today" in d.reason


def test_denies_when_month_spend_at_cap():
    d = _budget(
        account=_acct(monthly_cap=Decimal("1000")),
        month_spend_usd=Decimal("1000"),
    )
    assert not d.allowed and "monthly cap" in d.reason


# --------------------------------------------------------------------------- allow paths

def test_allows_small_change_without_approval():
    d = _budget(new_daily_budget_usd=Decimal("20"), dollar_delta_usd=Decimal("20"))
    assert d.allowed and not d.requires_approval


def test_allows_large_change_but_requires_approval():
    d = _budget(new_daily_budget_usd=Decimal("80"), dollar_delta_usd=Decimal("60"))
    assert d.allowed and d.requires_approval


def test_allows_up_to_cap_exactly():
    d = _budget(
        account=_acct(daily_cap=Decimal("50")),
        committed_daily_budget_usd=Decimal("30"),
        new_daily_budget_usd=Decimal("20"),
        dollar_delta_usd=Decimal("20"),
    )
    assert d.allowed  # 30 + 20 == 50, not over


# --------------------------------------------------------------------------- non-budget

def test_non_budget_pause_always_allowed_even_killed():
    d = evaluate_non_budget_action(
        account=_acct(killswitch=True), action="campaign.pause"
    )
    assert d.allowed


def test_non_budget_activate_denied_when_killed():
    d = evaluate_non_budget_action(
        account=_acct(killswitch=True), action="campaign.activate"
    )
    assert not d.allowed and "kill-switch" in d.reason


def test_non_budget_activate_denied_without_account():
    d = evaluate_non_budget_action(account=None, action="campaign.activate")
    assert not d.allowed
