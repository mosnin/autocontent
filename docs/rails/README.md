# Execution rails

Marketer's agents publish posts and move ad money for real people. The execution rails are the rules, and the code,
that every HIGH and CRITICAL action passes, so that this stays safe when an agent is wrong, a network drops, or a
person changes their mind halfway. They are modelled on coral's execution rails (withcoral/coral, Apache-2.0); we
borrowed the rules and the documentation discipline, not the code.

Words used here have one meaning each: [GLOSSARY.md](../GLOSSARY.md). The decisions behind the rules, with what we
considered: [docs/adr/](../adr/README.md).

## The rails in one picture

```
 agent tool call                                   web app request
      │                                                  │
      ▼                                                  │
 harness: schema → firewall → tier gateway → approval    │   (agent side, agent-starter executor)
      │        (bound to call id + tool + args hash)     │
      ▼                                                  │
 enforceAgentDispatch  ── tier · kill switch · caps · live+approved      agent/src/marketer/rails/enforce.ts
      │  (never auto-retried; unknown outcome → OUTCOME_UNKNOWN)
      ▼                                                  ▼
 Marketer API ───────────────────────────────────────────┤
                                                         ▼
 enforce_dispatch ── registered tier · kill switch · caps (domain guard) ·         src/marketer/rails/enforce.py
      │              unknown outcome on target · approval binding · idempotency key
      ▼
 Dispatch.run(side effect) ──► succeeded | failed | indeterminate                  src/marketer/rails/outcomes.py
      │                                        │
      ▼                                        ▼
 rails_executions (0027)              Required Action in GET /workspace/inbox      backend/routes/workspace.py
                                      (only a person resolves it)
```

## The rules, and why

1. **Every HIGH and CRITICAL action is named and tiered in code** ([risk-tiers.md](risk-tiers.md)). An action that is
   not in the table cannot run. Why: a path nobody reviewed has no tier, and "no tier" must not mean "no rules".
2. **One enforcement point per side reads current facts right before the side effect**
   ([enforcement-point.md](enforcement-point.md), ADR 0005). Why: approvals wait hours and caps change; a decision made
   earlier describes a world that may be gone.
3. **Kill switches stop new spend and publishing, never winding down** ([enforcement-point.md](enforcement-point.md)).
   Why: a kill switch exists so a person can stop things in one move; pausing and rejecting must stay possible while it
   is engaged.
4. **Approvals are bound to exact arguments and single use** ([approvals.md](approvals.md), ADR 0004). Why: a person
   approves "activate at $50/day", not "activate at whatever the draft says later".
5. **Money and publishing fail closed** (ADR 0003). Why: an unnecessary wait costs minutes; an unwanted spend or post
   cannot be undone.
6. **An unknown outcome is never retried; a person is asked** ([failure-semantics.md](failure-semantics.md),
   [required-actions.md](required-actions.md), ADR 0006). Why: a timeout after sending may mean the post is live;
   retrying is how a video gets posted twice.
7. **Replays of the same agent call dispatch at most once** (idempotency keys, [enforcement-point.md](enforcement-point.md)).
   Why: networks and workers retry; side effects must not.
8. **Models never loosen the rails** (ADR 0002). The rails take no input from a model.

## Where the code is

| Concern | Backend (Python) | Agent (TypeScript) |
|---|---|---|
| Reviewed action/tool table | `src/marketer/rails/actions.py` | `agent/src/marketer/rails/registry.ts` |
| Truth table (pure) | `src/marketer/rails/policy.py` (`evaluate`) | `agent/src/marketer/rails/enforce.ts` (`evaluateAgentDispatch`) |
| Enforcement point | `src/marketer/rails/enforce.py` (`enforce_dispatch`, `Dispatch`) | `enforce.ts` (`enforceAgentDispatch`), called by `writeTool` in `agent/src/marketer/tools/define.ts` |
| Canonical argument hash | `src/marketer/rails/canonical.py` | `agent/src/marketer/rails/canonical.ts` |
| Outcome classification | `src/marketer/rails/outcomes.py` | `isDefiniteRejection`, `IndeterminateOutcomeError` in `enforce.ts` |
| Persistence | `src/marketer/rails/store.py`, `db/migrations/0027_rails.sql` | harness ledgers (`as_approvals`, `as_idempotency`) |
| HTTP mapping | `src/marketer/rails/http.py` | `agent/src/marketer/api.ts` (status hints) |
| Required Actions | `backend/routes/workspace.py` (`required_actions`, resolve) | `get_workspace_inbox` tool reads them |
| Tests | `tests/test_rails_core.py`, `tests/test_rails_routes.py`, `tests/integration/test_pg_rails.py` | `agent/test/marketer-rails.test.ts` |

## Dispatch sites (backend)

| Action | Tier | Called from |
|---|---|---|
| `ads.budget.change` | CRITICAL | `services/ad_actions_exec.py::propose_budget_change` (route `POST /ads/campaigns/{id}/budget`, ads optimizer) |
| `ads.campaign.activate` / `.pause` / `.end` | CRITICAL / HIGH / HIGH | `backend/routes/ads.py::change_status` |
| `ads.approval.execute` | CRITICAL | `ad_actions_exec.py::execute_approved_budget_change`, `::execute_approved_activation` |
| `ads.approval.reject` | HIGH | `backend/routes/ads.py::decide_ad_approval` |
| `ads.account.governance` | HIGH | `backend/routes/ads.py::set_governance` |
| `content.video.approve` / `.reject` | HIGH | `backend/routes/jobs.py` |
| `content.carousel.approve` / `.reject` | HIGH | `backend/routes/image_posts.py` |
| `content.post.send` | HIGH | `src/marketer/pipeline.py::_schedule_stage`, `services/image_posts.py::schedule_image_post` |
| `campaigns.start` | HIGH | `backend/routes/campaigns.py::start_campaign` |
| `playbook.spend_cap.raise` / `.lower` | HIGH | `backend/routes/niches.py::update_niche` (when `daily_spend_cap_usd` changes) |
| `playbook.approval.disable` / `.enable` | HIGH | `backend/routes/niches.py::update_niche` (when `approve_before_post` changes) |
| `account.spend_cap.raise` / `.lower` | HIGH | `backend/routes/users.py::update_me` (when `global_daily_cap_usd` changes) |
| `brand_kit.update` | HIGH | `backend/routes/brand_kit.py::put_brand_kit` |

The workspace inbox's decide route dispatches to the department routes above, so it inherits their rails.

## The pages

- [risk-tiers.md](risk-tiers.md): the tables, and how to change a tier on purpose.
- [enforcement-point.md](enforcement-point.md): the check, its order, kill switches, caps, idempotency.
- [approvals.md](approvals.md): what an approval is bound to and what happens when the world changes.
- [failure-semantics.md](failure-semantics.md): succeeded, failed, indeterminate, denied; fail closed vs fail open.
- [required-actions.md](required-actions.md): the inbox lane and its API contract.
- [run-ledger.md](run-ledger.md): what is recorded today and what the full ledger will add.
- [recipes.md](recipes.md): saved compositions (design only).
- [decision-models.md](decision-models.md): how decision models relate to the rails.
- [runbooks.md](runbooks.md): engaging a kill switch, resolving unknown outcomes, a rails store outage, adding an action.

## Not built yet (on purpose)

Per-tool access states and the "Agent permissions" page, the unified Required Actions model for approvals and
`ask_person` questions, run deadlines, the per-run ledger rendered in Activity, fan-out limits for credit-spending
makers, and recipes. Each is described in the plan (`docs/research/EVALUATION.md` section 4) and, where a decision
was made, in an ADR.
