# The enforcement point

One function per side checks every HIGH and CRITICAL action against **current** facts, right before the side effect.
Nothing decided earlier (when the approval was requested, a value read at the top of the request, a model's opinion)
authorises the action; only what this check reads now. ADR 0005 records why.

## Backend: `enforce_dispatch`

`src/marketer/rails/enforce.py`

```python
dispatch = await rails.enforce_dispatch(
    "content.video.approve",            # registered action (rails/actions.py)
    user_id=ctx.user_id,
    principal=rails.principal_of(ctx),  # 'user' | 'agent' | 'system'
    args={"job_id": job_id},            # hashed canonically into the execution record
    target_type="job", target_id=str(job_id),
    caps=...,                           # optional: the domain guard, read now
    approval=..., approval_id=...,      # optional: the stored approval being executed
)
result = await dispatch.run(send)       # records succeeded / failed / indeterminate
```

What it does, in order (the truth table is `src/marketer/rails/policy.py::evaluate`, pure and tested row by row):

| # | Check | Refusal | Why this order |
|---|---|---|---|
| 1 | The action is registered | 403 `unregistered_action` | Without a tier nothing else means anything |
| 2 | Kill switches can be read | 503 `rails_unavailable` | Not knowing is not "off" (fail closed) |
| 3 | No kill switch in `all` or the action's scopes, unless it reduces exposure | 402 `kill_switch` | A person's stop beats everything below |
| 4 | Caps allow it (the domain guard, read now) | 402 (the guard's own reason) | Same contract as before the rails |
| 5 | No unresolved unknown outcome on the target, unless it reduces exposure | 409 `outcome_unknown` | Never stack a second attempt on an unknown first one |
| 6 | The approval being executed is `approved` and its binding matches | 409 `approval_*` | See [approvals.md](approvals.md) |
| 7 | The request's idempotency key was not already dispatched | 409 `duplicate_dispatch` | Replays dispatch at most once |

Then it inserts an execution record (`rails_executions`, outcome still null) and returns a `Dispatch`. If the store
cannot be read or written, the dispatch is refused with 503: an action we could not record is an action whose unknown
outcome nobody would ever see.

Refusals are recorded too (outcome `denied`, with the code), best effort.

### Status codes, and what the agent does with them

| Status | Meaning | Agent client hint (`agent/src/marketer/api.ts`) |
|---|---|---|
| 402 | Kill switch or cap | "blocked by a spend cap or guard: report it to the person, do not retry" |
| 409 | State changed: unknown outcome, approval no longer matches, duplicate | "state conflict: re-read the record before doing anything else" |
| 403 | Unregistered action (a bug) | surfaced as is |
| 502 `outcome_unknown:` | Sent, no answer | the harness treats 5xx as an unknown outcome; the agent rails say `OUTCOME_UNKNOWN`, do not retry |
| 503 `rails_unavailable` | Rails store down | try later; nothing was sent |

### Caps go through the enforcement point, not around it

Domain guards stay where they are and are passed in as `caps`:

- Ads: `services/ad_spend_guard.py` (account status, kill switch, daily and monthly caps, approval threshold) via
  `_gather_and_guard` / `guard_activation` in `services/ad_actions_exec.py`, and `evaluate_non_budget_action` in
  `backend/routes/ads.py::change_status`.
- A guard that raises (`AdSpendDenied`) propagates unchanged, so the existing audit rows (`budget.denied`) and 402
  responses are exactly what they were.

### Idempotency keys

The agent sends `idempotency-key` on every write (derived from run, call, tool and arguments). Each route module that
dispatches declares the router dependency `rails_request_context` (`src/marketer/rails/http.py`), which puts the
header in a context variable for `enforce_dispatch`. With a key:

1. If an earlier dispatch with this key is succeeded, indeterminate or still in flight: 409 `duplicate_dispatch`.
2. Otherwise claim `rails:{user}:{action}:{key}` in `idempotency_keys` (migration 0024; same atomic first-writer-wins
   claim the Modal spawns use). Losing the race: 409.
3. A definite failure releases the claim, so the same call may run again; success and indeterminate keep it.

Requests without a key (the web app) behave exactly as before. Approval executions pass `idempotency_key=""`: they
are single-use by the approval itself.

## Agent: `enforceAgentDispatch`

`agent/src/marketer/rails/enforce.ts`, called by `writeTool` (`agent/src/marketer/tools/define.ts`) for every HIGH and
CRITICAL tool, after the harness has validated the arguments and a person approved the call.

| # | Check | Refusal (`TOOL_NOT_ALLOWED`) |
|---|---|---|
| 1 | The tool is in `RAILS_TOOLS` | `RAILS_UNREGISTERED` |
| 2 | Its declared tier is not below the reviewed one | `RAILS_TIER_MISMATCH` |
| 3 | The call runs live (shadow and dry runs simulate earlier) | `RAILS_NOT_LIVE` |
| 4 | `MARKETER_RAILS_KILL_SWITCH` does not stop it (`all`, `publish`, `spend`; unreadable = `all`) | `RAILS_KILL_SWITCH` |
| 5 | Argument caps hold (`dailyBudgetUsd` ≤ 1,000) | `RAILS_CAP_EXCEEDED` |

Why an agent-side check when the backend checks too: it stops a whole agent fleet from one Worker secret without
touching the backend, it covers tools whose endpoints are outside the backend rails today (`set_playbook_spend_cap`,
`update_brand_kit`), and it turns unknown outcomes into an instruction the model follows ("do not call it again").

Approval on the agent side is the harness's: HIGH and CRITICAL always park; the approval record is bound to run, call
id, tool and `approvalArgsHash(args)`; a call with other arguments needs a new approval. The rails log that same hash
(`rails.dispatch`, `rails.outcome`) so a log line joins with its approval.

HIGH and CRITICAL tools are defined with `retry: { maxAttempts: 1 }`: the harness never retries them, even the ones
marked `idempotent` (an atomic claim makes a retry harmless, but it also turns "posted" into a confusing 409).

## Kill switches

| Switch | Where | Scope | Effect |
|---|---|---|---|
| `rails.kill_switch.all` | admin feature flags (`feature_flags`) | every tenant | stops every HIGH/CRITICAL backend action that does not reduce exposure |
| `rails.kill_switch.publish` | admin feature flags | every tenant | stops approving content, the post step, starting campaigns |
| `rails.kill_switch.spend` | admin feature flags | every tenant | stops budget changes, activation, approved ad executions, starting campaigns |
| `MARKETER_RAILS_KILL_SWITCH` | Worker env (secret or var) | the agent fleet | same scopes, agent tools only |
| `ad_accounts.killswitch` | per ad account (`PATCH /ads/accounts/{id}/governance`) | one ad account | read as a cap: stops spend growth on that account |

All are read at every dispatch. How to flip them: [runbooks.md](runbooks.md#engage-a-kill-switch).
