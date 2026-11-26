# Run ledger

Coral keeps one append-only, ordered record of everything in a run. Marketer has the pieces, in separate places. This
page says what exists, what each piece answers, and what the full ledger will add.

## What is recorded today

| Record | Where | Answers |
|---|---|---|
| Execution records | `rails_executions` (0027) | Every HIGH/CRITICAL dispatch: who (principal), what (action, canonical args hash), on what (target), under which key and approval, how it ended, and a person's resolution |
| Paid-media audit | `ad_actions_log` (0015, append-only) | Every ads action with actor and dollar delta (unchanged by the rails; `approval.invalidated` added) |
| Agent approvals | harness `as_approvals` | Who approved which call with which argument hash |
| Agent invocations | harness `as_idempotency`, telemetry, audit hook | STARTED / COMPLETED / FAILED / UNKNOWN per call |
| Rails log lines (agent) | `rails.dispatch`, `rails.denied`, `rails.outcome` via `ctx.log` | Tool, tier, backend action, args hash, outcome |
| Decision log | decisions modules (migration 0026) | Decision-model answers per point |

### Why `rails_executions` is "append-mostly"

A row is inserted once. Its `outcome` is set once (`UPDATE … WHERE outcome IS NULL`: first commit wins, a late success
never overwrites an `indeterminate`) and its `resolution` once (`WHERE resolution IS NULL`). The application never
deletes rows. This keeps one row per dispatch, easy to query for the inbox and the unknown-outcome check, while giving
the same guarantee as an event log for the fields that matter.

## What the full ledger adds (design)

Per department task: one ordered stream of decisions, invocations, approvals and outcomes, rendered in
`web/app/(app)/activity`, with attribution on every line (person, Marketer, autopilot, webhook) and decision-model
answers inline. The join keys already exist: `runId` and the call's idempotency key on the agent side, the same key on
`rails_executions.idempotency_key`, and `approvalArgsHash` on both the approval and the `rails.dispatch` line.
