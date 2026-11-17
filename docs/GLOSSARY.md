# Glossary

Each term has one meaning in Marketer's code, docs, UI copy and agent prompts. When a word under **Avoid** creeps in,
replace it: two words for one thing make people (and agents) think there are two things.

Terms marked **(design)** are named here so the docs stay consistent, but nothing implements them yet.

The execution rails are documented in [docs/rails/](rails/README.md); the decisions behind them in
[docs/adr/](adr/).

## People, agents and accounts

**Tenant**: One Marketer account and everything it owns: playbooks, content, campaigns, ad accounts, approvals.
Today a tenant is one Clerk user, and its id is the Clerk user id (`users.id`, `x-tenant-id`, `ctx.tenant.tenantId`).
A tenant id is never taken from tool arguments or a model's output. _Avoid_: workspace (that is the cross-department
page), org, customer, user (when you mean the account).

**Principal**: Who started an action, as recorded on every execution record: `user` (a person in the web app),
`agent` (the agent harness acting for the user through the service token, `AuthCtx.delegated`), or `system`
(a background job: the pipeline's post step, the ads optimizer). The principal is attribution, not authority: an
agent action still needs the person's approval where its tier requires one. _Avoid_: actor (the older `ad_actions_log`
column, which uses the same values), caller, requester.

**Person**: A human who can approve, reject and resolve. Only a person resolves a Required Action or approves CRITICAL
work. _Avoid_: human-in-the-loop (as a noun), operator (an admin role), user (ambiguous with Tenant).

**Department**: One of Marketer's six dispatch-only specialist agents (strategist, content producer, SEO editor, media
buyer, distribution manager, analyst). A department holds only its own tools (`DEPARTMENT_TOOLS`). _Avoid_: team,
sub-agent, worker.

## Tools and tiers

**Tool**: A typed capability an agent can call, defined with `defineAgentTool` (agent harness) and, for Marketer API
calls, with `readTool` / `writeTool` (`agent/src/marketer/tools/define.ts`). A tool declares its risk tier, side effect
and idempotency; nothing is inferred. _Avoid_: function, skill (a skill is instructions), action (the backend's word
for what a tool reaches).

**Action**: A named HIGH or CRITICAL backend operation in the rails registry (`src/marketer/rails/actions.py`), such as
`ads.budget.change` or `content.video.approve`. Every dispatch site names its action. _Avoid_: endpoint (one endpoint
can dispatch two actions), operation.

**Risk Tier**: LOW (reads), MEDIUM (spends content credits or creates drafts), HIGH (publishes, approves, rejects,
starts spend on a budget the person set, edits brand identity or caps), CRITICAL (moves real ad money). Reviewed
tables: `EXPECTED_RISK` (agent tests), `RAILS_TOOLS` (agent) and `ACTIONS` (backend). A tier is never lowered at
runtime, by a model or by anything else. _Avoid_: risk level, severity, priority.

**Reduces Exposure**: True for actions that only make things safer: pausing or ending a campaign, rejecting content or
an ad change. No kill switch blocks them and an unknown outcome on the target does not block them. _Avoid_: safe action
(every action should be safe), rollback.

**Access State** (design): A per-tenant, per-tool setting of `enabled`, `approval_required` or `disabled`. A person may
tighten any tool; loosening is capped by its tier (CRITICAL is always `approval_required`). Today the tier plus
`TenantConfig.deniedTools` play this role. _Avoid_: permission, toggle.

## The rails

**Execution Rails**: The rules and the code that every HIGH and CRITICAL action passes: tier, kill switch, caps,
unknown outcomes, approval binding, outcome recording. See [docs/rails/README.md](rails/README.md). _Avoid_: guardrails
(that is the model-output layer), safety layer, firewall (the agent harness's per-run call policy).

**Enforcement Point**: The one function per side that checks an action against current facts right before its side
effect: `enforceAgentDispatch` (agent, `agent/src/marketer/rails/enforce.ts`) and `enforce_dispatch` (backend,
`src/marketer/rails/enforce.py`). A decision made earlier (when the approval was requested, a cached read) never
authorises. _Avoid_: PEP (outside this glossary), gate, middleware, check (unqualified).

**Dispatch**: One attempt to perform an action after the enforcement point allowed it. On the backend it is an open
execution record (`Dispatch`) that must be settled exactly once. _Avoid_: request (the HTTP request may contain no
dispatch, or two), call.

**Kill Switch**: A switch that stops new dispatches in a scope: `all`, `publish` or `spend`. Backend: the admin feature
flags `rails.kill_switch.all|publish|spend`; agent: the Worker variable `MARKETER_RAILS_KILL_SWITCH`; per ad account:
`ad_accounts.killswitch` (read as a cap). Read at every dispatch; an unreadable switch counts as engaged. _Avoid_:
circuit breaker (that is the provider-health mechanism), pause button, maintenance mode.

**Cap**: A numeric ceiling checked in code at dispatch: ad account daily and monthly caps, the approval threshold, the
agent's per-call daily budget ceiling (`MAX_DAILY_BUDGET_USD`), a playbook's daily content spend cap. Arithmetic never
goes to a model. _Avoid_: limit (ambiguous with rate limits and quotas), budget (a campaign's budget is what a cap
bounds).

**Approval**: A person's single-use yes or no to one exact action with exact arguments. Agent side: the harness's
approval record, bound to run, call id, tool and argument hash. Backend: an `ad_approvals` row whose payload carries a
**Binding** (argument hash and governance hash). An approval whose binding no longer matches current facts is expired,
never executed. The agent never approves. _Avoid_: confirmation, permission, consent, sign-off (in code), authorization.

**Canonical Arguments**: The byte-exact serialisation hashed into a binding: keys sorted, no whitespace, money as a
plain decimal string with trailing zeros dropped. Same in both languages for JSON-native values (shared test vectors).
_Avoid_: normalized args, fingerprint.

**Governance Hash**: The hash of an ad account's status, kill switch and caps when an approval was requested. If any
of them changes before execution, the approval is refused. _Avoid_: account version (we hash, we do not version).

**Outcome**: How a dispatch ended: `succeeded`, `failed` (it provably did not happen), `indeterminate`, or `denied`
(refused before sending). _Avoid_: status (jobs and approvals have statuses), result.

**Indeterminate**: The outcome when a side effect was sent and no answer came back: a read timeout after sending, a
dropped connection, a 5xx, a process that died mid-send (a dispatch still open after 15 minutes). The post may be live
or the budget may be changed. Never retried automatically; becomes a Required Action. _Avoid_: unknown status, maybe,
pending, failed (it may have succeeded).

**Idempotency Key**: The key the agent harness derives from run, call, tool and arguments and sends as
`idempotency-key`. The backend enforcement point claims it (0024's `idempotency_keys`) so a replay of the same call
can never dispatch twice; a definite failure frees it. _Avoid_: request id, dedupe id, nonce.

**Execution Record**: One row of `rails_executions` (migration 0027): principal, action, tier, canonical args hash,
target, idempotency key, approval, outcome, and a person's resolution. Inserted once; each field set once by a guarded
update. _Avoid_: log line, audit entry (that is `ad_actions_log`), event.

**Required Action**: Something only a person can settle, with one link to settle it. Today: an indeterminate outcome,
listed in `GET /workspace/inbox` under `required_actions` and resolved with
`POST /workspace/required-actions/{id}/resolve`. The agent can read and pass on the link; it cannot resolve. Later
(design): pending approvals, account connections and `ask_person` questions in the same shape. _Avoid_: task, todo,
alert, notification.

**Resolution**: A person's statement of what actually happened to an indeterminate outcome: `confirmed_succeeded` or
`confirmed_failed`. It unblocks new dispatches on the same target. _Avoid_: retry, acknowledgement, fix.

**Target**: The thing an action changes, as `(target_type, target_id)`: `job`, `image_post`, `video_post` and
`carousel_post` (the social post of a video or carousel), `ad_campaign`, `ad_account`, `ad_approval`, `campaign`. An
unresolved indeterminate outcome blocks new dispatches on its target. _Avoid_: resource, object, entity.

## Runs and history

**Run**: One agent conversation's execution, or one department task, identified by `runId`. _Avoid_: session (a
Flue/transport term), job (a video pipeline row), thread.

**Invocation**: One tool call inside a run, from validation to outcome. The harness's idempotency ledger
(`as_idempotency`) tracks its STARTED / COMPLETED / FAILED / UNKNOWN state. _Avoid_: tool use, execution (backend
term), step.

**Run Ledger** (design): An append-only, ordered record of every decision, invocation, approval and outcome in a run,
rendered in Activity. Today the pieces exist separately: harness telemetry and audit, `ad_actions_log`,
`rails_executions`, the decision log. _Avoid_: history, trace, log.

**Recipe** (design): A saved, declarative composition of existing guarded tool calls with fixed parameters and a
narrower rule, with its own access state; every inner call still passes the enforcement point. See
[docs/rails/recipes.md](rails/recipes.md). _Avoid_: macro, workflow (Inngest's word), automation, program.

## Decisions and memory

**Decision Point**: A named place in code where a decision model's answers can change what happens (raise a tier, hold
a draft, rank options). Each point has a mode `off | shadow | enforce`, a versioned question set and a truth table
(`src/marketer/decisions/`, `agent/src/marketer/decisions/`). _Avoid_: AI check, model gate.

**Decision Model**: A model, called through OpenRouter, that answers atomic, observable questions with probabilities.
It judges; code decides. It may tighten (raise a tier, add a review) and never loosen. _Avoid_: classifier (unless it
is one), judge (as a noun for the component), decider.

**Truth Table**: The pure function that turns a decision model's answers, or the rails' facts, into an action. Every
row has a unit test. _Avoid_: rules engine, policy (unqualified).

**Learning** (design): A conclusion drawn from results (for example "hooks with a number beat hooks without on
TikTok for this playbook"), stored with the evidence that supports it. _Avoid_: insight, memory (too broad), tip.

**Fact** (design): A dated statement about the tenant's world (an entity attribute with a source and a validity
window). Facts are invalidated, never deleted. _Avoid_: memory, note (a note is free text), knowledge.

**Brand Rule**: A constraint from the brand kit that every draft must respect: banned words, tone, hashtags, colour.
Changing the brand kit is HIGH. _Avoid_: guideline, style (a style preset is a visual template).
