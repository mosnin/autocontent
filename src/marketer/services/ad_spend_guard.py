"""AdSpendGuard — the fail-CLOSED gate in front of every spend-affecting ad
action.

Ads move real money out of the user's payment method on the platform, so this
guard is the inverse of the notifications path: when anything is missing,
ambiguous, or over a ceiling, it DENIES. It never optimistically allows.

The evaluation is pure (no DB, no I/O) so it is exhaustively unit-testable; the
safe-execute layer (services/ad_actions_exec.py) gathers the inputs from repos
and calls in here, then routes ALLOW-with-approval through the approvals queue.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class AccountGovernance:
    """The governance snapshot the guard needs — decoupled from the repo model
    so the guard has no import cycle and tests can build inputs trivially."""

    status: str
    killswitch: bool
    daily_cap_usd: Decimal | None
    monthly_cap_usd: Decimal | None


@dataclass(frozen=True)
class GuardDecision:
    allowed: bool
    reason: str = ""
    # When allowed, whether the action must still be approved by a human before
    # it executes (large deltas). Meaningless when allowed is False.
    requires_approval: bool = False


def evaluate_budget_change(
    *,
    account: AccountGovernance | None,
    # Sum of the daily budgets of the account's OTHER active campaigns (i.e.
    # excluding the one being changed) — used to check the account-wide ceiling.
    committed_daily_budget_usd: Decimal,
    # The campaign's proposed new daily budget (0 to pause/stop spending).
    new_daily_budget_usd: Decimal,
    # Actual spend already booked today / this month (from ad_metrics_daily).
    today_spend_usd: Decimal,
    month_spend_usd: Decimal,
    # The increase in daily budget vs. its previous value (>=0 means growth).
    dollar_delta_usd: Decimal,
    approval_threshold_usd: Decimal,
) -> GuardDecision:
    """Decide whether a budget-affecting change may proceed. Fail-CLOSED."""
    # 1. There must be a healthy, connected account.
    if account is None:
        return GuardDecision(False, "no connected ad account")
    if account.status != "active":
        return GuardDecision(False, f"ad account is {account.status!r}, not active")
    # 2. Kill-switch halts all spend growth immediately. Reductions/pauses
    #    (delta <= 0 and new budget <= committed) are still allowed so operators
    #    can wind things down while killed.
    if account.killswitch and (dollar_delta_usd > 0 or new_daily_budget_usd > 0):
        return GuardDecision(False, "account kill-switch is engaged")
    # 3. No negative budgets.
    if new_daily_budget_usd < 0:
        return GuardDecision(False, "daily budget cannot be negative")

    # 4. Account-wide daily ceiling: the sum of committed daily budgets plus
    #    this change must fit under the cap, and today's booked spend must not
    #    already be at/over it.
    if account.daily_cap_usd is not None:
        projected = committed_daily_budget_usd + new_daily_budget_usd
        if projected > account.daily_cap_usd:
            return GuardDecision(
                False,
                f"projected daily budget ${projected} exceeds account daily "
                f"cap ${account.daily_cap_usd}",
            )
        if today_spend_usd >= account.daily_cap_usd:
            return GuardDecision(
                False,
                f"account daily cap ${account.daily_cap_usd} already reached "
                f"today (${today_spend_usd} spent)",
            )

    # 5. Monthly ceiling on booked spend.
    if account.monthly_cap_usd is not None and month_spend_usd >= account.monthly_cap_usd:
        return GuardDecision(
            False,
            f"account monthly cap ${account.monthly_cap_usd} already reached "
            f"this month (${month_spend_usd} spent)",
        )

    # 6. Allowed — but a large increase needs a human's sign-off first.
    requires_approval = dollar_delta_usd >= approval_threshold_usd
    return GuardDecision(True, requires_approval=requires_approval)


def evaluate_non_budget_action(
    *,
    account: AccountGovernance | None,
    action: str,
) -> GuardDecision:
    """Guard for spend-affecting actions that aren't a budget number — e.g.
    activating a campaign or resuming a paused one. Pausing/stopping is always
    allowed (it reduces spend); anything that starts or resumes spend needs a
    healthy, un-killed account."""
    reduces_spend = action in {"campaign.pause", "campaign.stop", "campaign.end"}
    if reduces_spend:
        return GuardDecision(True)
    if account is None:
        return GuardDecision(False, "no connected ad account")
    if account.status != "active":
        return GuardDecision(False, f"ad account is {account.status!r}, not active")
    if account.killswitch:
        return GuardDecision(False, "account kill-switch is engaged")
    return GuardDecision(True)
