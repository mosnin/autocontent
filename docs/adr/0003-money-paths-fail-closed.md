---
status: accepted
---

# Money paths fail closed

When anything on a path that moves money or publishes is missing, ambiguous or unreachable, the action does not run.
Content generation and ranking fail open to today's rule; money and publishing do not.

## Why

- **Ad spend leaves the customer's card** on the platform. A spend that should not have happened is a refund
  conversation at best. A spend that waited an hour for a person is an hour.
- **A post cannot be unposted** in the eyes of the people who saw it.
- **"We could not check" is not "it is fine".** A guard that allows on error is a guard that allows when it matters
  most: during an outage, a misconfiguration or an attack.

## What fails closed, concretely

| Missing or failing | Result | Code |
|---|---|---|
| Ad account absent, not active, kill switch on, over a cap | 402, audited | `services/ad_spend_guard.py` |
| Large budget delta | parked as an approval, not executed | `services/ad_actions_exec.py` |
| Rails kill-switch flags unreadable | 503 `rails_unavailable` | `rails/policy.py` row 2 |
| Rails ledger cannot record the dispatch | 503, nothing sent | `rails/enforce.py` |
| Action not in the rails registry | 403 `unregistered_action` | `rails/policy.py` row 1 |
| Agent kill-switch variable unreadable | treated as `all` | `agent/src/marketer/rails/enforce.ts` |
| HIGH/CRITICAL tool missing from the agent rails table | the tool cannot be defined | `agent/src/marketer/tools/define.ts` |
| Decision model times out on a money or publish point | sent to a person, never auto-approved | decisions modules |

## Considered options

- **Fail open with an alert.** Keeps the pipeline moving during a database blip; rejected for money and publishing,
  kept for notifications, archiving and the Modal spawn dedupe store (`services/idempotency.py`, where the spend
  re-check is the backstop).

## Consequences

- A rails store outage stops publishing and spending until it recovers. That is the intended trade; the runbook in
  [docs/rails/runbooks.md](../rails/runbooks.md) covers it.
- Reads never fail closed: the inbox still loads (without Required Actions) if the rails store cannot be read.
