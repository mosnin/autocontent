---
status: accepted
---

# Approvals are bound to exact arguments and single use

An approval authorises one action with one exact set of arguments, under the governance in force when it was
requested. At execution we recompute a canonical hash from current facts and refuse (409) if it differs. An approval
executes at most once; the first decision wins; the agent never approves.

## Why

Before this decision, an ad activation approval stored an empty payload and executed with whatever the campaign's
draft budget was **at execution time**. A person could approve "activate at $50/day", someone (or an agent) could
edit the draft to $500/day, and the approval would activate $500/day. The re-guard at execution caught only cap
breaches, not "this is not what I approved". The same gap existed for budget changes whose starting budget had moved:
"raise $20 → $35" executed as "$30 → $35" with a different delta than the one approved.

## Decision

- **What is bound.** Budget change: campaign, account, budget **from** and **to**. Activation: campaign, account,
  daily budget. Both: the account's governance (status, kill switch, daily and monthly caps). Agent tools: the
  harness binds run, call id, tool and argument hash (`approvalArgsHash`), and the rails log that same hash.
- **Where it is stored.** In `ad_approvals.payload_json` under `"rails"` (`action`, `args_hash`,
  `governance_hash`), written by the same INSERT that creates the approval, so there is no window where an approval
  exists without its binding and no repository change was needed.
- **Canonical form.** Sorted keys, no whitespace, money as a plain decimal string (`35.00` and `35` hash alike), the
  same bytes in Python and TypeScript for JSON-native values (shared vectors in both test suites).
- **On mismatch.** The enforcement point refuses with `approval_args_mismatch` or `approval_governance_changed`
  (409), expires the approval (`status = 'expired'`), and the decide route audits `approval.invalidated`. The person
  requests a new approval that describes the world as it is.
- **Legacy rows.** Approvals created before 0027 have no binding and execute as before (`legacy_unbound`), so a
  deploy never strands a pending approval.

## Considered options

- **Store a full copy of the arguments.** Lets the UI show a diff, but doubles what we store and still needs a
  comparison rule; the hash is the comparison rule. The payload already keeps the human-readable target budget.
- **Bind to a governance version counter.** Needs a column and a trigger on every governance write; hashing the
  four fields we actually guard needs neither.
- **Re-check only caps at execution (the old behaviour).** Catches over-cap spend, misses "not what was approved".

## Consequences

- Code: `src/marketer/rails/canonical.py`, `services/ad_actions_exec.py` (`budget_change_args`, `activation_args`,
  `rails_binding`, `_binding_check`), `rails/policy.py` row 6. Tests: `tests/test_rails_routes.py`
  (budget moved, cap edited, draft budget edited, unchanged, legacy), `tests/integration/test_pg_rails.py`.
- Editing caps while approvals are pending invalidates them. That is intended: the person approved under other caps.
