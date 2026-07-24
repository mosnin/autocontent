# Operate: the agent orchestration layer for marketer.sh

A staged plan to turn marketer.sh from *a set of pipelines you trigger*
into *an operations layer that runs itself and reports to you*.

Companion reference: [`operate_orch_terms.md`](./operate_orch_terms.md) —
the 120 orchestration patterns this plan draws on. Every term in that file
is accounted for in §2's coverage map: adopted into a phase, already
present in the codebase, or deliberately declined with a reason.

---

## 0. What we are actually optimizing

The brief says "two orders of magnitude better performance." Taken as a
throughput number that is not an engineering target, it is a wish. Taken
as a question — *what is the denominator, and what makes it 100× smaller?*
— it is answerable, and the answer determines the whole plan.

Today the denominator is **operator attention per shipped unit of work**.
A campaign runs because a person opened the app, picked a niche, checked a
queue, noticed a failure, and re-ran something. Models are already fast;
the bottleneck is the human in the loop and the rework caused by work that
was wrong, duplicated, or silently dropped.

100× comes from compounding four multipliers, none of which is model speed:

| Multiplier | Mechanism | Rough factor |
|---|---|---|
| **Unattended runs** | Recurring work executes and closes itself out; the operator sees exceptions, not tasks. | 5–10× |
| **Parallel breadth** | One operator supervises many Spaces (clients, brands, niches) instead of one. | 5–20× |
| **First-pass yield** | QA audits before publish, revision loops with specific findings, and memory of what failed last time kill the rework loop. | 2–3× |
| **Cost per unit** | Model routing + context budget + caching + semantic reuse cut spend per completed task. | 2–5× on cost |

The plan is ordered by that table, not by the notecard branches. Reliability
and unattended execution come first because a 100× fan-out of unreliable
work is 100× the cleanup.

**One honest caveat up front.** Multipliers this large are only real if
work that runs unattended is *trustworthy*. Every phase below therefore
carries its verification and its blast-radius control in the same phase —
not in a later "hardening" pass. A phase that ships the capability without
its guardrail is not done.

---

## 1. The organizing principle: what lives in the product vs. in skills

The brief asks whether these patterns belong in external skills, in the
product and DB, or both. The answer is a hybrid, and the split needs to be
a rule rather than a case-by-case judgment, or it will rot:

> **The product owns state, money, permissions, identity, scheduling, and
> durability. Skills own judgment, procedure, and taste.**

Corollaries that decide most arguments:

- Anything that must survive a crash, be audited, be billed, or be
  enforced against a hostile input is **product** (DB + service + policy).
  A skill is text; text cannot be a spend cap.
- Anything that a competent operator would express as *"here's how we do
  this"* is a **skill**: a versioned, portable package of instructions,
  checklists, examples, and references.
- The seam between them is the **task contract**: a skill proposes actions
  against a typed schema; the product validates, authorizes, executes,
  records, and pays for them. Skills never hold credentials and never
  perform side effects directly.

This is not a new invention for us — `Kit` (`src/marketer/models/schemas.py`)
already is a user-level skill injected into agent runtimes, and
`SpendContext` already is the product refusing what a prompt asked for.
Phase 5 generalizes both.

### The shape it takes: a corporation

That rule has a natural org. A **Manager** agent owns the objective, breaks
it into projects and tasks, and assigns them. A roster of **Employee**
agents carries out assigned work. A **QA** function reviews output against
the standard before it counts as done, and sends it back with specific
findings when it does not. The operator is the owner the manager reports
to — and the only one who can change what the standard is.

The metaphor earns its place in exactly three ways:

1. **Accountability** — every task has exactly one assignee, and delegating
   work does not transfer responsibility for it.
2. **Review lines** — who checks whose work is explicit, configurable data,
   not something implied by a prompt.
3. **Performance** — an employee whose work is measured can be compared,
   tuned, given more of what it is good at, or retired.

Where it stops, deliberately: no titles, no promotions, no org politics, no
simulated morale or personalities. Those are HR-ware — surface area with no
capability behind it. The corporation here is an accountability structure,
not a simulation of one.

---

## 2. Coverage map — all 120 patterns

Status key: **Have** = already in the codebase (may need formalizing);
**P*n*** = introduced in that phase; **Decline** = deliberately not adopted,
with the reason.

### Branch 1 — Cognition and decision architecture

| # | Term | Status | Where |
|---|---|---|---|
| 1 | Agentic loop | Have → P3.1 | pipelines today; becomes the Task Runner loop |
| 2 | Goal conditioning | P1.2 | Space objective conditions every task prompt |
| 3 | Objective function | P3.5 | Space scorecard; task acceptance criteria |
| 4 | Goal decomposition | P3.1 | Planner turns an objective into a task graph |
| 5 | Goal stack | P1.2 | `space → objective → task → action` rows |
| 6 | Constraint satisfaction | Have → P7.1 | spend caps, ad guard; generalized to guardrails |
| 7 | Plan and execute | P3.1 | separate Planner and Executor roles |
| 8 | Interleaved reasoning and action | P3.1 | Executor's think→tool→observe loop |
| 9 | Dynamic replanning | P3.2 | replan trigger on failed precondition |
| 10 | Hierarchical task planning | P3.1 | task → subtask → action |
| 11 | Task graph | P1.2 | `operate_tasks` + `operate_task_edges` |
| 12 | Dependency aware scheduling | P2.2 | ready-set computation in the dispatcher |
| 13 | Critical path | P2.3 | due-date propagation and lateness warning |
| 14 | Search based planning | P3.3 | N candidate plans before commit |
| 15 | Tree of Thoughts | P3.3 | branch/score/prune on high-stakes plans only |
| 16 | Graph of Thoughts | Decline | cost and complexity far exceed the gain for ops planning; ToT covers the useful case |
| 17 | Beam search | P3.3 | top-k plan retention |
| 18 | Monte Carlo tree search | Decline | needs a cheap simulator we do not have; the real environment is the only oracle |
| 19 | World model | P3.4 | outcome predictor from our own `post_metrics` history |
| 20 | Counterfactual simulation | P5.4 | dry run against the predictor |
| 21 | Policy | P3.5 | per-role action policy, versioned |
| 22 | Meta policy | P3.6 | strategy selector: which role/model/depth |
| 23 | Model routing | P3.6 | across LLMs and the 139-model Studio registry |
| 24 | Adaptive reasoning effort | P3.6 | effort tier from task risk × uncertainty |
| 25 | Inference time scaling | P3.7 | n-sample + verify on high-stakes outputs |
| 26 | Self reflection | P3.7 | draft→critique→revise before submit |
| 27 | Verifier model | Have → P3.7 | the QA agent; `agents/qa.py`, `video_qa.py` generalized |
| 28 | Process supervision | P3.7 | `qa_mode = process`: step-level acceptance |
| 29 | Value of information | P3.8 | ask-the-human threshold |
| 30 | Stopping criterion | P3.8 | success ∨ budget ∨ no-progress |

### Branch 2 — Context, memory, knowledge, state

| # | Term | Status | Where |
|---|---|---|---|
| 1 | Context engineering | P4.1 | the Context Assembler service |
| 2 | Context assembly | P4.1 | typed sections with provenance |
| 3 | Context window | Have | model limits respected today |
| 4 | Context budget | P4.2 | per-section token allocation |
| 5 | Context rot | P4.2 | eviction rules + budget telemetry |
| 6 | Context compression | P4.3 | rolling summaries at run boundaries |
| 7 | Semantic compression | P4.3 | concept/relation summaries, not truncation |
| 8 | Context distillation | P4.6 | trajectories → reusable lessons |
| 9 | Progressive disclosure | P4.2, P5.2 | skill body loaded only on trigger |
| 10 | Just in time context | P4.4 | retrieve at the step that needs it |
| 11 | Context caching | P4.5 | stable prefix ordering for prompt caching |
| 12 | Semantic cache | P4.5 | near-duplicate task result reuse |
| 13 | Working memory | P1.3 | `operate_runs.state` |
| 14 | Episodic memory | P4.6 | `operate_episodes` (what happened, what resulted) |
| 15 | Semantic memory | P4.6 | `operate_facts` (brand, audience, what works) |
| 16 | Procedural memory | P5.2 | Skills — literally this |
| 17 | Prospective memory | P2.1 | **the Scheduled Tasks tab** |
| 18 | Memory consolidation | P4.7 | nightly episode → fact promotion |
| 19 | Memory retrieval policy | P4.4 | goal+state ranked retrieval |
| 20 | Memory salience | P4.4 | relevance × importance × recency |
| 21 | Memory decay | P4.7 | age/contradiction downweighting |
| 22 | Memory provenance | P4.8 | every fact carries its source run |
| 23 | Retrieval augmented generation | P4.4 | over Space knowledge, not the open web |
| 24 | Hybrid retrieval | P4.4 | lexical + vector + graph + metadata |
| 25 | Reranking | P4.4 | cross-encoder pass on candidates |
| 26 | Knowledge graph | P4.9 | Space graph: brand, audience, asset, result |
| 27 | Temporal knowledge graph | P4.9 | facts valid over intervals |
| 28 | Agent state | P1.3 | typed run state |
| 29 | Checkpointing | P1.3 | snapshot at step boundaries |
| 30 | Event sourcing | P1.3 | `operate_events` as the source of truth |

### Branch 3 — Tools, protocols, environment

| # | Term | Status | Where |
|---|---|---|---|
| 1 | Tool calling | Have | agents call typed tools today |
| 2 | Function schema | Have → P5.1 | `studio_gen.input_schema` is the model to copy |
| 3 | Tool affordance | P5.1 | the Action Registry |
| 4 | Tool semantics | P5.1 | declared effects, limits, failure modes |
| 5 | Tool discoverability | P5.1 | capability search over the registry |
| 6 | Tool selection policy | P5.1 | fit × cost × permission × risk |
| 7 | Tool grounding | Have | tools read real state |
| 8 | Tool result normalization | P5.1 | canonical `ActionResult` |
| 9 | Structured output | Have | Pydantic everywhere |
| 10 | Schema adherence | Have → P5.1 | validation at the seam |
| 11 | Model Context Protocol | P5.3 | both directions |
| 12 | MCP client | P5.3 | Spaces can mount external MCP servers |
| 13 | MCP server | P5.3 | **marketer.sh exposed as an MCP server** |
| 14 | MCP transport | P5.3 | streamable HTTP, scoped tokens |
| 15 | Agent2Agent protocol | P5.3 (opt) | behind a flag; only if a partner needs it |
| 16 | Agent card | P5.3 | published capability manifest |
| 17 | Agent Skills | P5.2 | Kits → Skills v2 |
| 18 | Computer use | Decline (revisit) | cost and fragility are not justified while every surface we need has an API |
| 19 | Browser automation | P5.5 (narrow) | verify a published post actually rendered |
| 20 | Code execution | Decline | no task in this plan requires it; it is the largest attack surface we could add |
| 21 | Sandbox | Have → P5.5 | Modal containers; formalize the boundary |
| 22 | Side effect classification | P5.4 | every action declares its risk class |
| 23 | Idempotency | Have | `services/idempotency.py` |
| 24 | Idempotency key | Have | extended to Operate actions |
| 25 | Transaction | Have | Postgres |
| 26 | Compensating action | P5.4 | unpublish, pause, revert — declared per action |
| 27 | Dry run | P5.4 | plan preview with predicted effects |
| 28 | Capability based security | P5.4 | scoped grants per Space per agent |
| 29 | Least privilege | P5.4 | default-deny action grants |
| 30 | Credential delegation | Have → P5.4 | PATs today; scoped, expiring grants next |

### Branch 4 — Multi-agent orchestration, runtime, governance

| # | Term | Status | Where |
|---|---|---|---|
| 1 | Orchestrator | P6.1 | the Operate runtime |
| 2 | Supervisor pattern | P1.4, P6.1 | the Manager: plans, staffs, dispositions |
| 3 | Router pattern | P6.2 | cheap classifier → specialist |
| 4 | Handoff | P6.2 | typed context transfer |
| 5 | Delegation | P1.4, P6.2 | bounded subtask, accountability stays with the delegator |
| 6 | Blackboard architecture | P6.3 | the Space *is* the blackboard |
| 7 | Contract net protocol | Decline | bidding presumes competing autonomous agents; ours are our own roles with known costs |
| 8 | Role specialization | P1.4 | employees carry role, tools, skills, grants, capacity |
| 9 | Swarm orchestration | Decline | emergent coordination is unauditable, and audit is a product requirement |
| 10 | Parallel fan out and fan in | P6.4 | per-task concurrency with a join |
| 11 | Map reduce for agents | P6.4 | e.g. 40 competitor posts → one brief |
| 12 | Consensus mechanism | P6.5 | majority/quorum on judgments |
| 13 | Debate protocol | P6.5 | reserved for irreversible decisions |
| 14 | Shared state | P6.3 | Space state with optimistic concurrency |
| 15 | Message passing | P6.3 | typed handoff records |
| 16 | Actor model | Decline | Modal already gives us isolated concurrent execution; a second concurrency model would be duplication |
| 17 | Durable execution | P1.3 | event-sourced runs |
| 18 | Deterministic replay | P1.3, P7.4 | replay a run from its event log |
| 19 | Saga pattern | P5.4 | ordered steps + compensations |
| 20 | Backpressure | Have | `services/provider_limits.py` |
| 21 | Work stealing | Decline | our queue is centrally dispatched; stealing solves a problem we do not have |
| 22 | Circuit breaker | Have → P7.5 | `provider_fallback.py`; add explicit open/half-open state |
| 23 | Bulkhead isolation | Have | `provider_limits.py`, `concurrency.py` |
| 24 | Dead letter queue | Have → P2.4 | `routes/failures.py` becomes actionable, not read-only |
| 25 | Distributed tracing | Have → P7.4 | `services/otel.py` spans over agent steps |
| 26 | Trace grading | P7.4 | score whole trajectories |
| 27 | Agent evaluation | P7.6 | offline eval suite + per-employee scorecards |
| 28 | Guardrail | P7.1 | pre/post checks on every action |
| 29 | Policy as code | P7.2 | versioned, testable rules |
| 30 | Budget governor | Have → P7.3 | `SpendContext` extended to time/tokens/actions |

**Totals: 112 adopted (48 building on what exists), 8 declined.**

---

## 3. The one assumption to confirm

The brief says *"inside of the spaces we need a built in tab for scheduled
tasks."* There is no `Space` in the codebase today. This plan defines it,
and the definition is the single decision that changes the most downstream
work, so it is stated plainly rather than buried:

> A **Space** is the container an operator works *inside*: one client, one
> brand, or one initiative. It owns an objective, a budget, connected
> accounts, knowledge, skills, agent roles, and scheduled work. Campaigns,
> niches, articles, ad accounts, and Studio generations become things a
> Space *contains* rather than top-level lists.

The migration is additive: every existing row gets a `space_id`, and every
current account is backfilled with one Default Space, so nothing breaks and
nothing has to move on day one. If the intended meaning was narrower —
a tab inside the existing Campaigns product rather than a new container —
Phases 1.1 and 8 shrink substantially and the rest of the plan is unchanged.

---

## PART I — Foundations

*Nothing above this line can be trusted until this part is done. It is the
least visible work in the plan and the most load-bearing.*

### Phase 1.1 — Spaces

**Ships:** a Space container with members, settings, and a tabbed shell.

Data model (`db/migrations/0027_spaces.sql`):

```sql
create table spaces (
  id uuid primary key,
  user_id text not null,
  name text not null,
  objective text not null default '',      -- goal conditioning, branch 1.2
  status text not null default 'active',   -- active | paused | archived
  timezone text not null default 'UTC',    -- schedules are local to a Space
  budget_usd numeric(12,4),                -- rolls up to SpendContext
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`space_id uuid references spaces(id)` is added — nullable, then backfilled,
then made not-null — to `niches`, `campaigns`, `articles`, `jobs`,
`ad_accounts`, `kits`, `studio_generations`.

Tabs (all inside the existing `SiteShell`, built from
`components/square/ui/*` — no new design system):
`Overview · Scheduled · Work · Team · Knowledge · Skills · Activity · Settings`

**Done when:** an operator can create a Space, everything they already had
appears inside their Default Space, and no existing route regressed.

### Phase 1.2 — The goal stack and the task graph

**Covers:** goal conditioning, goal stack, goal decomposition, hierarchical
planning, task graph.

```sql
create table operate_objectives (
  id uuid primary key, space_id uuid not null, user_id text not null,
  title text not null, success_criteria jsonb not null default '[]',
  target_date date, status text not null default 'open'
);

create table operate_tasks (
  id uuid primary key, space_id uuid not null, user_id text not null,
  objective_id uuid, parent_task_id uuid,       -- hierarchy
  title text not null, brief text not null default '',
  kind text not null,                            -- maps to an action or a role
  status text not null default 'todo',           -- todo|ready|running|blocked|
                                                 -- review|done|failed|cancelled
  assignee_role text,                            -- null = human
  acceptance jsonb not null default '[]',        -- objective function, per task
  inputs jsonb not null default '{}',
  risk text not null default 'low',              -- drives approval + effort
  due_at timestamptz, priority int not null default 3,
  schedule_id uuid,                              -- set when spawned by a schedule
  created_at timestamptz not null default now()
);

create table operate_task_edges (
  task_id uuid not null, depends_on_task_id uuid not null,
  primary key (task_id, depends_on_task_id)
);
```

The task row is deliberately the same object whether a human or an agent
does it. That is what makes the Scheduled tab a checklist an operator can
read, and simultaneously a work queue an agent can drain.

**Done when:** a task graph can be created, queried as a DAG, and rendered;
cycles are rejected at write time.

### Phase 1.3 — Durable execution: events, state, checkpoints

**Covers:** agent state, checkpointing, event sourcing, durable execution,
deterministic replay, working memory.

```sql
create table operate_runs (
  id uuid primary key, task_id uuid not null, space_id uuid not null,
  user_id text not null, status text not null default 'queued',
  role text not null, attempt int not null default 1,
  state jsonb not null default '{}',        -- working memory, checkpointed
  cost_usd numeric(12,6) not null default 0,
  tokens_in bigint not null default 0, tokens_out bigint not null default 0,
  trace_id text, started_at timestamptz, ended_at timestamptz
);

create table operate_events (
  id bigserial primary key, run_id uuid not null, seq int not null,
  kind text not null,   -- planned|tool_called|tool_result|observed|checkpoint|
                        -- guardrail_blocked|handoff|error|finished
  payload jsonb not null, created_at timestamptz not null default now(),
  unique (run_id, seq)
);
```

Every step appends an event before it acts and after it observes. Run state
is a fold over events, so a container that dies mid-step resumes from the
last checkpoint instead of restarting — and a run can be replayed offline
for debugging and grading.

This reuses the pattern `studio_generations` already proved: claim
atomically (`claim_for_run`), write a terminal row on every exit path, reap
what stalls.

**Done when:** killing a worker mid-run and re-dispatching produces one
logical effect, not two, and the event log alone reconstructs final state.

### Phase 1.4 — The org: manager, employees, review lines

**Covers:** role specialization, delegation, supervisor pattern (the roster
half; the coordination half is Part VI).

An **agent** is a configured employee: a role plus its model defaults,
policy, skills, grants, budget, and capacity. Roles are the job
descriptions; agents are the staff.

```sql
create table operate_agents (
  id uuid primary key, space_id uuid not null, user_id text not null,
  name text not null,                        -- "Ops Manager", "Senior Writer"
  role text not null,                        -- manager|researcher|writer|qa|…
  reports_to_agent_id uuid,                  -- org chart; null = reports to the operator
  can_assign boolean not null default false, -- only manager-class agents
  can_review boolean not null default false, -- only QA-class agents
  status text not null default 'active',     -- active | paused | retired
  policy_id uuid, skill_ids uuid[] not null default '{}',
  grant_ids uuid[] not null default '{}',
  model_defaults jsonb not null default '{}',
  budget_usd numeric(12,4),                  -- per period, rolls into the governor
  max_concurrent int not null default 1,     -- capacity, i.e. headcount as a dial
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`operate_tasks` gains the columns that make a task a work assignment:

```sql
alter table operate_tasks
  add column assigned_agent_id uuid,     -- null = assigned to the operator
  add column reviewer_agent_id uuid,     -- who audits it; null = no audit
  add column qa_mode text,               -- null = inherit (see Phase 3.7)
  add column revision_round int not null default 0;
```

Four rules, enforced in the service rather than asked for in a prompt:

- **Only `can_assign` agents may create or assign tasks.** Assignment is an
  action in the registry like any other, subject to grants — a manager that
  can assign work does not thereby gain the power to publish it.
- **`reports_to_agent_id` must be acyclic** and every chain must terminate
  at the operator. An org with no human at the top is an org with no owner.
- **An agent can never review its own work.** `reviewer_agent_id !=
  assigned_agent_id`, checked at write time. Self-approval is not QA.
- **Capacity is a budget lever.** `max_concurrent` and per-agent budget are
  how an operator scales a team up or down; adding staff is a settings
  change, not a deploy.

**Done when:** an operator can see their org chart, hire (create), pause,
and retire employees, and every task in the Space names both who does it
and who checks it.

---

## PART II — Scheduled work (the Scheduled tab)

*This is the phase that produces the "unattended runs" multiplier, and it
is the feature the brief named. It is second only because it is worthless
on a runtime that loses work.*

**Covers:** prospective memory, dependency-aware scheduling, critical path,
idempotency, dead letter queue.

### Phase 2.1 — Schedules and instances

A schedule is *prospective memory*: a stored intention that fires when a
condition becomes true.

```sql
create table operate_schedules (
  id uuid primary key, space_id uuid not null, user_id text not null,
  name text not null, description text not null default '',
  trigger_kind text not null,     -- cron | interval | event | manual
  cron text,                      -- evaluated in the Space's timezone
  event_key text,                 -- e.g. 'post.published', 'metrics.dropped'
  window_start time, window_end time,   -- "sometime between 9 and 11"
  template jsonb not null,        -- the task set to instantiate
  enabled boolean not null default true,
  catch_up boolean not null default false,  -- missed fire: run late or skip
  max_concurrent_instances int not null default 1,
  last_fired_at timestamptz, next_fire_at timestamptz
);

create table operate_schedule_instances (
  id uuid primary key, schedule_id uuid not null, space_id uuid not null,
  user_id text not null, scheduled_for timestamptz not null,
  status text not null default 'pending',   -- pending|running|done|missed|failed
  idempotency_key text not null unique,     -- schedule_id + scheduled_for
  unique (schedule_id, scheduled_for)
);
```

The unique `(schedule_id, scheduled_for)` pair *is* the idempotency
guarantee: a daily 9am task set cannot double-fire because a cron ran twice
or a container retried.

**Templates are the useful unit.** A schedule instantiates a *set* of tasks
with their dependencies, each already assigned to an employee and — where
QA is on — to a reviewer. "Daily content ops" is not one task, it is a
morning of work the team walks through:

```
09:00  Pull yesterday's metrics            Analyst        low     no QA
   ↓
09:05  Flag underperformers vs. baseline   Analyst        low     no QA
   ↓
09:10  Draft 3 replacement hooks           Writer         low     QA: sample
   ↓
09:20  Queue winners for render            Director       medium  QA: always
   ↓                                                              ↳ QA agent
   ↓                                                                audits,
   ↓                                                                revises once
09:30  Approve the queue                   You            —       blocking
```

A manager agent can also author schedules: "every Monday, plan the week"
is a scheduled task assigned to the Manager whose *output* is next week's
task graph. That is the recursion that makes the system run itself — the
manager's own work is scheduled work like anyone else's, and is auditable
the same way.

### Phase 2.2 — The dispatcher

A minute-resolution Modal cron that:

1. Materializes due instances (respecting `catch_up` and
   `max_concurrent_instances`).
2. Instantiates the template into `operate_tasks` + edges.
3. Computes the **ready set** — tasks whose dependencies are all `done` —
   and marks them `ready`.
4. Dispatches `ready` agent tasks to the runtime, under the Space's
   concurrency bulkhead and budget governor.
5. Leaves `ready` human tasks alone; they simply appear checkable.

### Phase 2.3 — Critical path and lateness

Compute the longest dependency chain to each `due_at`, propagate implied
start times backward, and surface *"this will be late"* before it is late,
naming the blocking task. Cheap to compute, disproportionately useful — it
converts a missed deadline from a postmortem into a morning warning.

### Phase 2.4 — Failure handling: retries, DLQ, exception inbox

Per-task retry policy with transient-only predicates (the discipline
`retry_policy.py` already enforces for providers). After the limit, the task
lands in a **dead letter queue** that is *actionable*, not merely readable:
inspect the trace, edit the inputs, retry, reassign to a human, or cancel.
`routes/failures.py` becomes the read model for this.

### Phase 2.5 — The Scheduled tab UI

Three views over one data model, in our existing kit:

- **Today** — a checklist. Each row: title, assignee (role avatar or
  "You"), status, and a checkbox. Agent rows check themselves off as their
  run reaches `done`; human rows are checked by a person. Live via SWR
  polling while anything is non-terminal (same mechanism the Studio
  history uses).
- **Schedules** — the recurring definitions, with next fire time, last
  outcome, and an enable toggle.
- **Timeline** — instances over the past/next N days, late items marked.

**Done when:** an operator can define "every weekday at 9am, do these five
things," walk away, and come back to four of them checked off and one
waiting for their review — with the cost of the run visible on the instance.

---

## PART III — Cognition

*Turns "run the pipeline" into "decide what to do, do it, check it."*

### Phase 3.1 — Planner / Executor split

Two roles, distinct prompts, distinct budgets. The Planner emits a task
graph against a schema (never prose). The Executor runs one task at a time
in a think→tool→observe loop, appending events. Neither role can act
outside the Action Registry (Phase 5.1).

### Phase 3.2 — Dynamic replanning

Each task carries **preconditions**. Before execution, the Executor checks
them; a violated precondition raises a replan against the Planner with the
new evidence attached, rather than executing work built on a false premise.
Replans are capped per objective (a replan loop is a failure mode, not a
feature) and logged as events.

### Phase 3.3 — Search-based planning (high-stakes only)

For tasks flagged `risk >= high`: generate *k* candidate plans, score them
against the objective's success criteria with a separate judge, keep the
top-*b* (beam), expand once, commit to the winner while grafting the best
elements of the runners-up. Explicitly *not* the default path — it costs
multiples and pays only where a wrong plan is expensive.

### Phase 3.4 — A modest world model

We have something most teams do not: `post_metrics`, per platform, per
niche, over time. Train (or, initially, fit a simple calibrated baseline
on) a predictor of *expected outcome given a content decision*, and use it
for (a) ranking candidate plans, (b) dry-run previews, (c) flagging
proposals that our own history says will underperform. Start deliberately
dumb — a per-niche/per-platform baseline with confidence intervals beats no
predictor and cannot mislead the way an over-fit model can.

### Phase 3.5 — Policies and the objective function

Every task's `acceptance` array is its objective function: typed,
checkable criteria ("length ≤ 34s", "hook present in first 2s", "no
competitor named", "brand colors from the kit"). A role's **policy** is
versioned config — which actions it may take in which states — stored, not
prompt-embedded, so it can be diffed and rolled back.

### Phase 3.6 — Meta policy: routing and effort

One selector decides, per task: which role, which model, how much
reasoning effort, and whether to use search. Inputs: task kind, risk,
historical difficulty for this task type, current budget headroom,
uncertainty from the last attempt. This is where the **cost multiplier**
lives — most tasks are routed to cheap models at low effort, and the
expensive path is reserved for what actually needs it. The Studio registry
(139 models with real prices) already gives the media half of this a real
cost table to route against.

### Phase 3.7 — Quality assurance: audits, verdicts, revision loops

The brief asks for QA audits and revision feedback loops that can be
**toggled on**. This phase is that feature, and it is what makes unattended
work safe enough to fan out.

#### The toggle

`qa_mode` resolves most-specific-wins: task → task kind → schedule → Space
default. Four values:

| Mode | What happens | Use |
|---|---|---|
| `off` | Ships on the executor's own self-critique. | Reversible, low-stakes work. |
| `sample` | Audits a configurable percentage. | Steady-state work you already trust. |
| `always` | Every task audited before it can reach `done`. | Anything published or paid for. |
| `process` | Step-level audit during the run, not just at the end. | High risk, long tasks. |

Sampling is not decoration: it is how you keep measuring quality after you
stop auditing everything, so a regression surfaces before it compounds.

#### Three layers of checking

1. **Self-reflection** (all modes, including `off`): draft → critique
   against the task's `acceptance` → revise, once, inside the run.
2. **Independent audit** (`sample`, `always`): a QA agent that *only*
   scores and never rewrites, given the acceptance criteria and the
   artifact. Generalizes `agents/qa.py` and `services/video_qa.py`.
3. **Process supervision** (`process`): step-level acceptance so a bad step
   is caught at step 3 rather than in the finished artifact.

#### The verdict

```sql
create table operate_reviews (
  id uuid primary key, task_id uuid not null, run_id uuid,
  space_id uuid not null, user_id text not null,
  reviewer_agent_id uuid not null,
  round int not null default 1,
  verdict text not null,          -- pass | revise | reject | escalate
  score numeric(4,3),             -- against the acceptance criteria
  findings jsonb not null default '[]',
  -- findings: [{criterion, met, evidence, suggested_fix}]
  created_at timestamptz not null default now()
);
```

**Findings are per criterion, with evidence and a suggested fix.** This is
the difference between a loop that converges and one that does not: a
reviewer who says "make it better" produces a second draft that is
differently wrong. A reviewer who says *"criterion 3 (hook in first 2s) not
met — the hook lands at 4.1s; cut the establishing shot"* produces a fix.

#### The revision loop

```text
Employee submits → status: review
   ↓
Reviewer scores against acceptance
   ↓
pass ─────────→ done
revise ───────→ back to the assignee with findings, revision_round += 1
reject ───────→ failed (with the reason on the task)
escalate ─────→ blocked, with a specific question for the operator
```

Bounded by `max_revision_rounds` (default 2). Exceeding it **escalates
rather than loops** — an unbounded revise cycle is the expensive failure
mode of this whole design, and the cap is enforced by the runtime, not by
asking the reviewer to be reasonable. Each round's cost is charged to the
task and visible on it, so a task that took four attempts is not silently
as cheap as one that took one.

Two rules that protect the measurement:

- **The reviewer never rewrites.** The moment QA fixes the work itself, the
  employee's quality signal disappears and Phase 7.6's numbers become
  fiction.
- **A `revise` verdict must cite at least one unmet criterion.** A verdict
  with no findings is rejected as malformed, which prevents "vibes" review.

#### The loop that teaches

Every review is an event and an episode. When the same finding recurs
across an employee's tasks, consolidation (Phase 4.7) proposes it as a
durable correction: an addition to that role's skill, a fact in the Space's
knowledge, or a tightened acceptance criterion. **That is where QA stops
being a tax and becomes the mechanism that raises first-pass yield** — the
2–3× multiplier in §0 is this loop, not the audit itself.

### Phase 3.8 — Stopping and value of information

Every run stops on: acceptance met, budget exhausted (money, tokens, wall
clock, or attempts), or no measurable progress across N steps. Separately,
a **value-of-information** check decides when to *ask the operator* instead
of guessing: when the expected cost of being wrong exceeds the cost of the
interruption, the task moves to `blocked` with a specific question. Asking
well is a feature; asking constantly is the thing that destroys the
unattended-run multiplier, so the threshold is tuned and measured.

---

## PART IV — Context and memory

*The compounding advantage. A Space that remembers is worth more every week
it runs; a Space that does not is worth the same on day 300 as day 1.*

### Phase 4.1 — The Context Assembler

One service builds every prompt from typed sections, each with a source and
a token cost: `instructions · space objective · task brief · working state
· retrieved facts · retrieved episodes · skill bodies · tool results`.
No agent assembles its own context ad hoc. This single chokepoint is what
makes budgeting, caching, provenance, and debugging possible at all.

### Phase 4.2 — Context budget, rot, and progressive disclosure

Each section gets a token allocation per role. Over-budget sections are
compressed or evicted by policy, never truncated blindly. Skills load their
*name and trigger* always, their *body* only when triggered. Budget usage
is telemetry: a role that is always at ceiling is a design bug.

### Phase 4.3 — Compression, semantic and rolling

At run boundaries, trajectories become concept-and-relation summaries
("tried X, failed on Y because Z") rather than truncated transcripts.

### Phase 4.4 — Retrieval: JIT, hybrid, ranked, reranked

Retrieval happens at the step that needs it, over the Space's own knowledge
(not the open web): lexical + vector + graph + metadata filters, merged and
reranked. Salience = relevance × importance × recency. The retrieval policy
is a versioned config, and what it returned is recorded in the run's events
so a bad answer can be traced to bad evidence.

### Phase 4.5 — Caching, exact and semantic

Order context sections stable-prefix-first so prompt caching actually hits.
Add a semantic cache keyed on task kind + normalized inputs: a
near-identical task within a TTL reuses the prior result, with an explicit
"reused from" marker in the UI — never silently.

### Phase 4.6 — Episodic, semantic, and procedural memory

```sql
create table operate_episodes (
  id uuid primary key, space_id uuid not null, user_id text not null,
  run_id uuid, task_kind text not null, summary text not null,
  outcome text not null,              -- succeeded | failed | rejected
  lesson text,                        -- distilled, nullable
  embedding vector(1536), created_at timestamptz not null default now()
);

create table operate_facts (
  id uuid primary key, space_id uuid not null, user_id text not null,
  subject text not null, predicate text not null, object text not null,
  confidence numeric(4,3) not null default 0.5,
  valid_from timestamptz, valid_to timestamptz,     -- temporal
  source_run_id uuid, source_kind text not null,    -- provenance
  supersedes uuid, embedding vector(1536)
);
```

Procedural memory is Skills (Phase 5.2) — the same idea, authored rather
than learned.

### Phase 4.7 — Consolidation and decay

A nightly job promotes repeated episode patterns into facts, decays facts
that are old/unused/contradicted, and retires superseded ones. Consolidation
is *proposed* and, above a confidence threshold, surfaced for operator
confirmation rather than silently believed.

### Phase 4.8 — Provenance

Every fact and every generated claim carries the run, the tool call, and
the evidence that produced it. The UI can always answer "why does it think
that," which is the difference between a system an operator trusts with
100× the work and one they double-check.

### Phase 4.9 — The Space knowledge graph

Entities (brand, product, audience, competitor, asset, channel, campaign,
result) and typed, time-bounded relations. Enables the questions retrieval
alone answers badly: *what did we ship for this audience last quarter and
how did it do?*

---

## PART V — Tools, skills, and safety

### Phase 5.1 — The Action Registry

Every side-effecting capability declared once, with: JSON Schema inputs,
declared effects, **risk class**, cost estimate, required grants, retry
semantics, idempotency key derivation, and its compensating action. The
Studio work already proved this shape — `StudioModel.input_schema` with the
server as the authority and the UI building controls from it. Generalize it:
agents discover actions by capability search, and select by
fit × cost × permission × risk.

Result normalization: one `ActionResult` envelope so downstream steps never
parse vendor shapes.

### Phase 5.2 — Skills v2 (Kits, generalized)

`Kit` becomes `Skill`: versioned, scoped (user / space / role), with
`triggers`, `body`, `examples`, `resources`, `checklists`, and
`required_actions`. Importable, exportable, and shareable — this is the
"external skills the agents import" half of the brief. Skills are the
**procedural memory** of the system, and the natural place for the
notecards' own content to live as reference material an agent can pull in.

Crucially: a skill can *require* actions but can never *grant* them. Grants
come from Phase 5.4.

### Phase 5.3 — MCP, both directions

- **As a server:** expose Spaces, tasks, schedules, knowledge, and safe
  actions over MCP with scoped, expiring tokens. This is the highest-
  leverage item in the whole plan for external agents: any MCP-capable
  agent can then create, manage, and run projects in marketer.sh without
  us shipping a client for it.
- **As a client:** a Space can mount external MCP servers, and their tools
  enter the Action Registry with the same risk classification and grants as
  ours. No special case for third-party tools.
- **Agent card:** publish the capability manifest so discovery works.
- A2A stays behind a flag until a real counterparty needs it.

### Phase 5.4 — Least privilege, dry run, sagas, compensation

- **Side-effect classes:** `read < write_internal < spend < publish <
  irreversible`. Class determines approval, verification depth, and whether
  a dry run is mandatory.
- **Grants:** default-deny, per Space, per role, per action, scoped and
  expiring. An agent's authority is data, not prompt text.
- **Dry run:** high-class actions render a preview — exact payload,
  predicted effect (Phase 3.4), estimated cost — for approval.
- **Sagas and compensation:** multi-step external work declares its
  compensations up front; a mid-saga failure runs them in reverse. A
  publish that half-succeeded across three platforms must not be left as
  three unknown states.

### Phase 5.5 — Sandboxing and narrow browser use

Formalize what a run may touch (filesystem, network egress allowlist,
credentials). Browser automation is scoped to *verification* — confirming a
published post actually rendered — not general web operation.

---

## PART VI — The corporation at scale

*Only now, because a team on an unreliable, unaudited substrate multiplies
problems faster than output. Phase 1.4 gave us a roster; this part is how a
roster does work together.*

### Phase 6.1 — The manager and staffing

The Manager holds the objective, decides what the work is, staffs it, and
decides what happens next when a result comes back. Concretely it owns
three loops:

- **Planning** — objective → projects → task graph (Phase 3.1), on a
  schedule ("every Monday, plan the week") or on demand.
- **Staffing** — which employee takes which task, given role fit, current
  load against `max_concurrent`, remaining per-agent budget, and the
  performance history in Phase 7.6. An overloaded employee is a queue, not
  a failure — the manager either waits, splits the work, or asks the
  operator to raise capacity.
- **Disposition** — on `pass`, close and move on; on `reject` or repeated
  `revise`, decide whether to re-brief, reassign to a different employee,
  or escalate to the operator.

Roles (Researcher, Strategist, Writer, Director, Editor, Analyst,
Publisher, QA) are configuration: prompt, policy, tools, skills, grants,
budget, capacity, model routing defaults. Operators can edit them and add
their own — this is where "more customization for the AI agents" lands in
the UI without changing the shell.

A **project** is the unit a manager works in: an objective, its task graph,
its staffed team, its budget, and its deadline. It is the same rows as
everything else — objectives and tasks — with a view over them, not a new
concept to maintain.

### Phase 6.2 — Router, handoff, delegation

A cheap classifier routes incoming work to a role. Handoffs are typed
records (what was done, what remains, what is uncertain) — not a dumped
transcript. Delegation keeps accountability with the delegator: the parent
task stays open until the child's acceptance passes, which is the whole
point of an org chart that terminates at a human.

### Phase 6.3 — The Space as blackboard

Shared state with optimistic concurrency (version column, compare-and-swap)
so parallel roles cannot silently clobber each other. Message passing over
shared mutation for anything cross-role.

### Phase 6.4 — Fan-out / fan-in and map-reduce

First-class parallel subtasks with a join and a synthesis step. The
canonical wins: analyze 40 competitor posts → one positioning brief;
generate 12 hook variants → rank → keep 3; audit 200 published posts
against brand rules → one exception list.

### Phase 6.5 — Consensus and debate

For irreversible or high-spend decisions: independent judgments from
diverse perspectives, combined by an explicit rule (majority, quorum, or
veto). Debate — where two proposals attack each other before a judge —
is reserved for the genuinely contested calls, because it is expensive.

---

## PART VII — Governance, observability, evaluation

*Runs alongside every part above, gated as its own deliverables.*

### Phase 7.1 — Guardrails

Pre-action and post-action checks: brand rules, banned claims, PII,
platform policy, spend, rate limits. Block, modify, or escalate — every
decision an event. Distinct from QA (Phase 3.7): a guardrail asks *"is this
allowed?"*, QA asks *"is this good?"*. Both can stop a task; only QA sends
it back with findings.

### Phase 7.2 — Policy as code

Rules as versioned, testable, diffable code with a test suite, not prose in
a prompt.

### Phase 7.3 — Budget governor

`SpendContext` extended from money to money + tokens + wall clock + action
counts + concurrency, per Space, per agent, per schedule, per run.
Fail-closed, as today. Revision rounds spend from the task's budget, so a
loop cannot quietly outspend the work it is improving.

### Phase 7.4 — Tracing and trace grading

OTel spans across agents, tools, and models, joined to `operate_events`;
graded trajectories locate *workflow* failures (right answer, insane path)
that output-only grading misses.

### Phase 7.5 — Circuit breakers

Explicit open/half-open/closed per provider and per action, building on
`provider_fallback.py`.

### Phase 7.6 — Agent evaluation and performance analytics

Two halves that share one metric definition, so the offline number and the
number on the Team tab mean the same thing.

**Offline evaluation.** A golden task set per role, run on every
policy/prompt/skill change, scored on success, trajectory quality, cost and
latency. **No policy or skill change ships without an eval delta.**

**Online performance.** A daily rollup per employee, from events and
reviews — no new instrumentation, just a fold over what Parts I and III
already record:

```sql
create table operate_agent_metrics_daily (
  agent_id uuid not null, space_id uuid not null, user_id text not null,
  day date not null, task_kind text not null,
  assigned int, completed int, failed int,
  first_pass_passes int,        -- passed QA at round 1
  revision_rounds int,          -- total rounds consumed
  escalations int, rejections int,
  avg_review_score numeric(4,3),
  cost_usd numeric(12,6), tokens_in bigint, tokens_out bigint,
  p50_cycle_sec int, p90_cycle_sec int,
  on_time int, late int,
  primary key (agent_id, day, task_kind)
);
```

Derived and shown per employee, per task kind:

| Metric | Definition | What it tells you |
|---|---|---|
| First-pass yield | `first_pass_passes / completed` | Is this employee's work good the first time? |
| Revision load | `revision_rounds / completed` | What does its quality actually cost? |
| Cost per accepted task | `cost_usd / completed` | The number that matters for routing. |
| On-time rate | `on_time / (on_time + late)` | Can you schedule around it? |
| Escalation rate | `escalations / assigned` | Is it interrupting you too much? |
| Review score trend | 7/28-day `avg_review_score` | Is it drifting? |

Three rules that keep these numbers honest:

- **Never compare across task kinds.** A Writer's first-pass yield on hooks
  and on long-form are different jobs; the primary key includes
  `task_kind` for exactly this reason.
- **Suppress small samples.** A scorecard on three tasks is noise. Below a
  threshold, show the count and withhold the rate rather than printing a
  confident-looking 67%.
- **Attribute honestly.** A task that failed because a provider was down is
  not the employee's miss; failures carry a cause class and infrastructure
  causes are excluded from quality metrics (and reported separately).

**The loop closes here.** These metrics feed the meta policy (Phase 3.6):
routing prefers the employee with the best cost-per-accepted-task for a
given task kind, and an employee whose review scores drift gets sampled
more heavily by QA until it recovers or is retired. Measurement that does
not change behaviour is a dashboard; this is a control loop.

---

## PART VIII — UI: more capability, same shell

Non-negotiable: this all renders inside the existing `SiteShell` with
`components/square/ui/*`, light theme, and the taste rules in
`.claude/skills/no-vibecoded-ui/SKILL.md`. No second design system, no
decorative icons, no invented chrome.

What is genuinely new is **fields, not surfaces**:

- **Space tabs** — `Overview · Scheduled · Work · Team · Knowledge ·
  Skills · Activity · Settings`. ("Agents" becomes "Team", which is what
  it is.)
- **Scheduled tab** — Today (checklist) / Schedules (definitions) /
  Timeline. Rows use the existing table and badge primitives; the only new
  primitive is a checkbox row an agent can also tick. Each row shows who
  it is assigned to and, when QA is on, who reviewed it.
- **Task detail** — brief, acceptance criteria, dependencies, assignee,
  reviewer, risk, revision round, cost so far, review findings, and the run
  trace. This is where most of the added customization lives.
- **Team tab** — the roster as a table: name, role, reports-to, status,
  capacity, and this period's scorecard (first-pass yield, revision load,
  cost per accepted task, on-time rate). Click through to one employee for
  their trend, recent tasks, and their editable policy, skills, and grants.
  The org chart is a small nested list, not a diagram — it is four levels
  deep at most and a diagram would be decoration.
- **QA settings** — one select on the Space (`off / sample / always /
  process`) with a sampling percentage, plus overrides per schedule and per
  task kind in the same shape. `max_revision_rounds` sits beside it. No
  wizard; it is four fields.
- **Review inbox** — tasks sitting in `review`, with findings inline and
  the artifact alongside. An operator can override any verdict, and the
  override is recorded as a review of its own so it shows up in the
  employee's numbers rather than vanishing.
- **Knowledge tab** — facts and episodes with provenance and confidence,
  editable and deletable by the operator.
- **Approvals** — one inbox for everything blocked on a human, with the
  dry-run preview inline. (Escalations from a blown revision cap land here,
  carrying every round's findings so the operator can see why it stalled.)
- **Overview** — the Space's own analytics: throughput, first-pass yield,
  cost per accepted task, and on-time rate over time, plus what is late and
  what is blocked. Charts come from the existing `chart` primitive; per the
  taste rules, a number with a real denominator beats a gauge.
- **Activity** — the event stream, filterable, with cost per run.

Progressive disclosure applies to the UI too: the default view of a Space
is the checklist and the exceptions. Everything above is available and
nothing is in the way.

---

## PART IX — Sequencing, and what "done" means

| Wave | Phases | Why this order |
|---|---|---|
| **A** | 1.1–1.4 | Nothing is trustworthy without durable, replayable runs — and the roster, because a task with no assignee is not an assignment. |
| **B** | 2.1–2.5, **3.5, 3.7**, 7.3, 7.1 | Ships the named features together: scheduled work that runs unattended, acceptance criteria to judge it by, and the QA audit + revision loop that makes running it unattended defensible. Budget and guardrails in the same wave. |
| **C** | 5.1, 5.2, 5.4 | Actions, skills, and least privilege — the seam that lets employees do more without being able to do harm. |
| **D** | 4.1–4.5 | Context discipline; cuts cost per task and stops rot before memory grows. |
| **E** | 3.1, 3.2, 3.8, **7.6** | Plan/execute/stop, plus the performance analytics that make the QA loop steerable rather than merely present. |
| **F** | 4.6–4.9, 7.4 | Memory that compounds — including turning recurring review findings into durable corrections — plus trace grading. |
| **G** | 6.1–6.4, 3.6 | The manager staffing real teams, and routing that spends the Phase 7.6 numbers. |
| **H** | 5.3, 3.3, 3.4, 6.5, 5.5, 7.2, 7.5 | Force multipliers and the expensive-path patterns, last. |

Waves A–B are the minimum that delivers the brief's stated features
honestly: a team, scheduled work, QA with revision loops. C–E are where the
performance claim is actually earned. F–H are leverage on top.

**Definition of done for the programme**, stated as measurements rather
than adjectives — each needs a baseline captured in Wave A, or the claim is
unfalsifiable:

1. Share of scheduled tasks completing unattended, without operator touch.
2. Operator minutes per shipped unit of work.
3. First-pass yield: share of artifacts passing QA at round 1.
4. Revision rounds per accepted task (the cost of that yield).
5. Escalation rate: share of tasks that end up asking the operator.
6. Cost per accepted task (tokens + provider spend).
7. Spaces concurrently managed per operator.
8. Mean time to detect a failed run (target: before the operator notices).

---

## Risks, and where this plan could be wrong

- **Over-building the runtime.** Waves A and C are large and invisible.
  Mitigation: ship the Scheduled tab in Wave B, on top of A — visible value
  early, and it exercises the substrate.
- **Agents that ask too much.** A system that blocks on every judgment
  destroys the main multiplier. The value-of-information threshold (3.8)
  must be measured, not assumed.
- **Memory that misleads.** A confidently wrong consolidated fact is worse
  than no memory. Hence provenance (4.8), confidence, decay (4.7), and
  operator-visible knowledge (Part VIII) as hard requirements, not extras.
- **Eval debt.** Without 7.6, every later phase is unfalsifiable tinkering.
  It is placed in Wave F, which is the latest it can responsibly go.
- **The `space_id` migration.** Touching seven tables is the highest-
  regression-risk item here. Additive, backfilled, three-step (nullable →
  backfill → not-null), with the rollback written first.
- **The org metaphor running away with the design.** "Corporation" is a
  useful frame for accountability, review lines, and measurement. It is a
  terrible frame for everything else, and it invites building HR-ware —
  titles, promotions, personalities, org-chart diagrams — that costs
  surface area and returns nothing. The constraint in §1 is load-bearing:
  if a proposed feature does not serve accountability, review, or
  performance, the metaphor is not a reason to build it.
- **Revision loops that do not converge.** The expensive failure mode of
  Part III: an employee and a reviewer trading drafts on someone else's
  budget. Mitigated by a hard `max_revision_rounds` cap enforced by the
  runtime, findings that must cite a specific unmet criterion, and per-task
  cost that includes every round so a four-attempt task cannot hide.
- **QA that becomes a rubber stamp.** An auditor with a weak rubric passes
  everything and costs money for nothing. Mitigated by acceptance criteria
  being typed and checkable (3.5) rather than prose, and by sampling
  continuing after `always` is relaxed, so the pass rate stays measured.
- **Scorecards that mislead.** Small samples, cross-kind comparisons, and
  infrastructure failures attributed to an employee will all produce
  confident nonsense that then steers routing. The three rules in 7.6 exist
  because this is the most likely way the analytics do harm rather than
  nothing.
- **Scope.** This is a large programme. Waves A–B are a coherent product on
  their own; every wave after that is separately shippable, and the plan is
  written so that stopping after any wave leaves something whole.
