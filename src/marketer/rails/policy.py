"""The enforcement truth table (docs/rails/enforcement-point.md).

Pure: no I/O, no clock, no database. ``enforce.py`` gathers current facts and
calls ``evaluate``; this module only turns facts into a verdict, so every row
of the table is a unit test (tests/test_rails_policy.py).

Order, first failing check wins:

1. **Registered action.** Unknown action names are refused. A HIGH/CRITICAL
   path that forgot to register would otherwise run with no tier at all.
2. **Kill switch readable.** If we cannot read the kill switches we do not
   know whether a person pulled one, so we refuse (503). Money and publishing
   fail closed.
3. **Kill switch engaged.** ``all`` or one of the action's scopes stops it,
   unless the action reduces exposure (pause, end, reject), which nothing
   blocks.
4. **Caps.** The domain guard's verdict on caps, read now (ads: account
   status, daily and monthly caps, kill switch on the account). ``None`` means
   no cap applies to this action.
5. **No unresolved unknown outcome on the target.** If an earlier dispatch
   on the same target (this video, this ad campaign) ended ``indeterminate``
   and no person has said what happened, a new dispatch could double post or
   double spend. Refused (409) until someone resolves the Required Action.
   Actions that reduce exposure are still allowed.
6. **Approval binding.** When the dispatch executes a stored approval: the
   approval must be ``approved``; its argument hash must equal the hash of the
   arguments about to run; its governance hash (caps when it was requested)
   must equal the governance now. Approvals stored before 0027 carry no hash
   and are executed as before (``legacy_unbound``), so a deploy never strands
   a pending approval.
"""
from __future__ import annotations

from dataclasses import dataclass

from .actions import RailsAction


@dataclass(frozen=True)
class CapsVerdict:
    allowed: bool
    reason: str = ""


@dataclass(frozen=True)
class ApprovalBinding:
    status: str
    stored_args_hash: str | None
    current_args_hash: str
    stored_governance_hash: str | None = None
    current_governance_hash: str | None = None


@dataclass(frozen=True)
class DispatchFacts:
    action: RailsAction | None
    kill_switches: frozenset[str]
    kill_switch_known: bool = True
    caps: CapsVerdict | None = None
    unresolved_on_target: bool = False
    approval: ApprovalBinding | None = None


@dataclass(frozen=True)
class Verdict:
    allowed: bool
    code: str
    reason: str = ""
    # HTTP status the backend answers with on a denial. 402 is what the agent
    # client already reads as "blocked by a guard: tell the person, do not
    # retry"; 409 as "state changed: re-read before doing anything".
    http_status: int = 200


OK = "ok"


def evaluate(facts: DispatchFacts) -> Verdict:
    action = facts.action
    if action is None:
        return Verdict(False, "unregistered_action", "action is not registered with the rails", 403)

    if not facts.kill_switch_known:
        return Verdict(False, "rails_unavailable", "kill switch state is unavailable; refusing to act", 503)

    if not action.reduces_exposure:
        engaged = sorted(facts.kill_switches & ({"all"} | set(action.scopes)))
        if engaged:
            return Verdict(False, "kill_switch", f"kill switch engaged ({', '.join(engaged)})", 402)

    if facts.caps is not None and not facts.caps.allowed:
        return Verdict(False, "cap_exceeded", facts.caps.reason or "blocked by a spend cap", 402)

    if facts.unresolved_on_target and not action.reduces_exposure:
        return Verdict(False, "outcome_unknown", "an earlier attempt has an unknown outcome; check the platform and resolve it in the inbox first", 409)

    binding = facts.approval
    if binding is not None:
        if binding.status != "approved":
            return Verdict(False, "approval_not_approved", f"approval is {binding.status!r}, not approved", 409)
        if binding.stored_args_hash is None:
            return Verdict(True, "legacy_unbound")
        if binding.stored_args_hash != binding.current_args_hash:
            return Verdict(False, "approval_args_mismatch", "the action no longer matches what was approved; request a new approval", 409)
        if binding.stored_governance_hash is not None and binding.stored_governance_hash != binding.current_governance_hash:
            return Verdict(False, "approval_governance_changed", "account caps or kill switch changed after approval was requested; request a new approval", 409)

    return Verdict(True, OK)
