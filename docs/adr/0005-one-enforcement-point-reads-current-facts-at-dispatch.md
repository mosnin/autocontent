---
status: accepted
---

# One enforcement point reads current facts at dispatch

Every HIGH and CRITICAL action passes one function, per side, right before its side effect: `enforce_dispatch`
(backend) and `enforceAgentDispatch` (agent). It reads current facts and checks, in order: registered tier, kill
switch, caps, unknown outcomes on the target, approval binding. A cached decision never authorises.

## Why

- **Checks spread over five routes drift into five different checks.** Before this decision, ads had a strong
  fail-closed layer while publishing approvals, campaign starts and rejections had none beyond an atomic claim.
- **Time passes between asking and doing.** Approvals wait hours; agents plan, then act. Caps, kill switches and
  account state can change in between. Only facts read at dispatch describe the world the action changes.
- **One place to audit.** Every dispatch, allowed or refused, leaves an execution record with principal, tier,
  canonical arguments and outcome.

## Decision

- Backend: `src/marketer/rails/enforce.py` gathers facts and calls the pure truth table in `rails/policy.py`. Called
  from `backend/routes/ads.py` (budget, status, governance, approval decide), `jobs.py` (approve, reject),
  `image_posts.py` (approve, reject), `campaigns.py` (start), `services/ad_actions_exec.py` (budget change, both
  approved executions) and the post step (`pipeline.py`, `services/image_posts.py`).
- Agent: `agent/src/marketer/rails/enforce.ts`, called from `writeTool` for every HIGH/CRITICAL tool. The backend
  check is authoritative; the agent check is the first wall and covers tools whose endpoints are outside the backend
  rails (playbook spend cap, brand kit).
- Domain guards stay where they are and are called **through** the enforcement point as the caps check
  (`ad_spend_guard.py`), so their audit trail and 402 contract are unchanged.

## Considered options

- **A FastAPI middleware.** Sees only the HTTP request, not the target, the approval or the domain guard, and cannot
  cover Modal jobs.
- **Run coral itself as a gateway.** Its model fits, but it would sit between our Worker and our own API: one hop and
  one system too many. We borrowed the rules, not the runtime.

## Consequences

- Adding a HIGH/CRITICAL path means adding its action to `rails/actions.py` (and its tool to `rails/registry.ts`),
  calling `enforce_dispatch`, and settling the returned `Dispatch`. An unregistered action is refused.
- Each dispatch costs two small reads (kill-switch flags, unresolved outcomes on the target, both index lookups), one
  insert and one update. We have not benchmarked it; next to a Modal spawn or a platform call it should be noise, and
  `rails_executions_target_idx` keeps the unresolved check a partial-index lookup. Measure before optimising.
