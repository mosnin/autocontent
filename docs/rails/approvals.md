# Args-bound approvals

An approval is a person's single-use yes to **one exact action with exact arguments, under the conditions they saw**.
When it executes, we recompute what it is bound to from current facts. If anything differs, it does not run.
ADR 0004 records the decision and the bug that motivated it.

## Two kinds of approval

| | Agent tool approval | Ad approval |
|---|---|---|
| What it gates | A HIGH/CRITICAL tool call by an agent | A large ad budget change or an activation, from anyone |
| Store | harness `as_approvals` (agent Durable Object) | `ad_approvals` (Postgres) |
| Bound to | run, call id, tool, `approvalArgsHash(args)` | action, campaign, account, budget from/to, governance |
| Who decides | the person, through the approval card or link | the person, in the inbox or ads page (`decide_ad_approval`) |
| Single use | executes once; replays return the recorded result | `pending → approved → executed`, guarded updates |

An agent can request both. Only a person decides either. The `decide_ad_approval` tool exists, but it is CRITICAL with
`requiresApproval`: the person approves the agent's call in the harness before it can decide anything.

## What an ad approval is bound to

Computed in `src/marketer/services/ad_actions_exec.py`:

| Approval | Bound arguments (`args_hash`) | Also bound |
|---|---|---|
| `budget.change` | `campaign_id`, `ad_account_id`, `prev_daily_budget_usd` (the campaign's budget when requested), `new_daily_budget_usd` | `governance_hash`: account status, kill switch, daily cap, monthly cap |
| `campaign.activate` | `campaign_id`, `ad_account_id`, `daily_budget_usd` (the draft's budget when requested) | `governance_hash` |

Why the starting budget: "raise $20 → $35" and "$30 → $35" have different deltas, and the delta is what the threshold
and the person judged. Why governance: a person approves under the caps in force; if someone raises a cap (or flips the
account kill switch) before execution, the approval no longer describes the risk they accepted.

Stored in the approval's payload, written by the same INSERT:

```json
{
  "new_daily_budget_usd": "35",
  "rails": { "action": "ads.budget.change", "args_hash": "…64 hex…", "governance_hash": "…64 hex…" }
}
```

Why the payload and not new columns: the binding exists from the first moment the approval does (no window where an
approval has no binding), and the repository did not change. The `payload` field is already part of the approvals API;
the `rails` key is additive.

## Canonical arguments

`src/marketer/rails/canonical.py` and `agent/src/marketer/rails/canonical.ts`:

- object keys sorted, no whitespace, UTF-8 as is, `null` kept;
- integers as integers; a float with no fraction as an integer;
- `Decimal` as a plain decimal string without trailing zeros (`35.00` → `"35"`), so money is compared by value;
- UUIDs and dates as strings.

The hash is `sha256(canonical({"action": ..., "args": ...}))`. Both languages produce the same bytes for JSON-native
values; `tests/test_rails_core.py` and `agent/test/marketer-rails.test.ts` pin the same three vectors.

## Execution

`execute_approved_budget_change` and `execute_approved_activation` build an `ApprovalBinding` from the stored payload
and current facts and pass it to `enforce_dispatch("ads.approval.execute", ...)`:

| Situation | Result |
|---|---|
| Status is not `approved` | 409 `approval_not_approved` |
| No `rails` entry (created before 0027) | executes as before (`legacy_unbound`) |
| Argument hash differs | 409 `approval_args_mismatch`; approval set to `expired`; `approval.invalidated` audited |
| Governance hash differs | 409 `approval_governance_changed`; same |
| Everything matches | caps re-checked now, then the platform call through `Dispatch.run`; approval marked `executed` |

A cap breach at execution still leaves the approval `approved` for a later retry, as before the rails: the person's
intent is unchanged and the blocker may clear. A binding mismatch expires it: the person's intent no longer applies.

## What the person sees

The decide call answers 409 with the reason (`approval_args_mismatch: the action no longer matches what was approved;
request a new approval`). The approval disappears from the pending list (`expired`). The agent, if it asked, gets the
same 409 and the hint to re-read the record.
