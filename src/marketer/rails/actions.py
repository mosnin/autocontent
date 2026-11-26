"""The reviewed list of HIGH and CRITICAL backend actions (docs/rails/risk-tiers.md).

Every endpoint or job that publishes, spends, or changes what may be spent
names one of these actions when it calls ``enforce_dispatch``. An action that
is not listed here is refused (fail closed), so adding a new HIGH/CRITICAL path
means adding it here on purpose, with a test.

The agent side keeps the matching table in
``agent/src/marketer/rails/registry.ts``; ``tests/test_rails_registry.py`` and
``agent/test/marketer-rails.test.ts`` pin both.

Fields:

- ``tier``: HIGH (publishes, approves, rejects, starts spend on a budget the
  person set) or CRITICAL (moves real ad money). Tiers are fixed in code; no
  runtime input can lower one.
- ``scopes``: which kill switches stop the action besides ``all``.
  ``publish`` stops anything that posts to a social channel, ``spend`` stops
  anything that starts or raises spend.
- ``reduces_exposure``: pausing, ending and rejecting make things safer, so no
  kill switch ever blocks them. Being able to wind down is the point of a kill
  switch.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Tier = Literal["HIGH", "CRITICAL"]
Scope = Literal["publish", "spend"]
KILL_SWITCH_SCOPES: tuple[str, ...] = ("all", "publish", "spend")


@dataclass(frozen=True)
class RailsAction:
    name: str
    tier: Tier
    scopes: frozenset[str]
    reduces_exposure: bool = False
    summary: str = ""


def _a(name: str, tier: Tier, scopes: tuple[Scope, ...] = (), *, reduces: bool = False, summary: str = "") -> RailsAction:
    return RailsAction(name=name, tier=tier, scopes=frozenset(scopes), reduces_exposure=reduces, summary=summary)


ACTIONS: dict[str, RailsAction] = {
    a.name: a
    for a in (
        # Paid media (backend/routes/ads.py, services/ad_actions_exec.py)
        _a("ads.budget.change", "CRITICAL", ("spend",), summary="Change a campaign's daily budget"),
        _a("ads.campaign.activate", "CRITICAL", ("spend",), summary="Activate a campaign so it spends"),
        _a("ads.campaign.pause", "HIGH", ("spend",), reduces=True, summary="Pause a live campaign"),
        _a("ads.campaign.end", "HIGH", ("spend",), reduces=True, summary="End a live campaign"),
        _a("ads.approval.execute", "CRITICAL", ("spend",), summary="Execute an approved ad change"),
        _a("ads.approval.reject", "HIGH", reduces=True, summary="Reject a pending ad change"),
        _a("ads.account.governance", "HIGH", summary="Change account caps or kill switch"),
        # Content publishing (backend/routes/jobs.py, image_posts.py; pipeline send)
        _a("content.video.approve", "HIGH", ("publish",), summary="Approve a video for posting"),
        _a("content.video.reject", "HIGH", reduces=True, summary="Reject a video"),
        _a("content.carousel.approve", "HIGH", ("publish",), summary="Approve a carousel for posting"),
        _a("content.carousel.reject", "HIGH", reduces=True, summary="Reject a carousel"),
        _a("content.post.send", "HIGH", ("publish",), summary="Send a post to the social scheduler"),
        # Story videos (src/marketer/story/service.py): executing a person's
        # approval of a render whose estimate is at or above the approval line.
        _a("content.story.render", "HIGH", ("spend",), summary="Render an approved, large story video"),
        # Campaigns (backend/routes/campaigns.py)
        _a("campaigns.start", "HIGH", ("publish", "spend"), summary="Start or resume a campaign"),
        # Spending limits and the publishing gate (backend/routes/niches.py,
        # users.py, brand_kit.py). Raising a limit and lowering it are separate
        # actions because only the first one adds exposure: a kill switch must
        # stop a raise and must never stop a person from tightening.
        _a("playbook.spend_cap.raise", "HIGH", ("spend",), summary="Raise a playbook's daily content spend cap"),
        _a("playbook.spend_cap.lower", "HIGH", reduces=True, summary="Lower a playbook's daily content spend cap"),
        _a("playbook.approval.disable", "HIGH", ("publish",), summary="Let a playbook post without a person's approval"),
        _a("playbook.approval.enable", "HIGH", reduces=True, summary="Require approval before a playbook posts"),
        _a("account.spend_cap.raise", "HIGH", ("spend",), summary="Raise or remove the account's global daily spend cap"),
        _a("account.spend_cap.lower", "HIGH", reduces=True, summary="Lower or set the account's global daily spend cap"),
        _a("brand_kit.update", "HIGH", summary="Replace the brand kit every draft and post is written from"),
    )
}


def get(name: str) -> RailsAction | None:
    """The registered action, or None (the enforcement point then refuses)."""
    return ACTIONS.get(name)
