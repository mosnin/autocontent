---
name: agent-starter-planning-and-cognition
description: Give Agent Starter agents structured thinking — planning tools (plan_goals / update_goal) over a SQLite goal tree with failure bubbling and re-planning, the intent Planner, critic reflection and self-critique limits (maxReflectionsPerResponse), the drift sentinel, deterministic FSM workflows (createJobStateMachineDefinition, transition_state) with render-time and execution-time tool gating, autonomy tiers and confidence thresholds (AutonomyGateway), Flue subagents for parallel fan-out, deep-research and long-horizon patterns, and how the spec's cognitive modules (scratchpad, critic, executive monitor, goal tree, healer, risk matrix) map to code. Use when an agent must follow a business process, plan multi-step work, recover from failures without looping, stay on objective over many turns, delegate to subagents, or decide what it may do without a human.
---

# Planning and cognition

## When to use
- Multi-step or long-running work: background jobs, research, coding, anything over ~3 tool calls.
- A business process with fixed stages that the model must not skip or invent (INGEST → EVALUATE → EXECUTE → REPORT).
- The agent loops on the same error, wanders off-objective, or acts too autonomously or too timidly.
- Parallel delegation to subagents, or choosing between subagents and a multi-agent room.

## Mental model: spec cognitive modules → code → wiring

| Spec module | Core implementation | Flue agents (`useAgentStarter`) | `AgentRuntime` loop |
|---|---|---|---|
| Dynamic goal tree (MARK_SUCCESS / MARK_FAILED / SPAWN_CHILD) | `GoalTree` (`cognition/goal-tree.ts`, `as_goal_tree`) | ✅ `planning: true` → `plan_goals`, `update_goal`; tree rendered into instructions | ✅ `update_goal` tool + tree in the system prompt |
| Intent and execution planner (cheap model decomposes, intent policy limits sub-graphs) | `Planner` (`cognition/planner.ts`): `decompose`, `validate` (deps, cycles, tool allowlist), `load`, `replan` (≤ `maxReplans` 3); `GoalTree.allowedToolsNow()` | ✅ on by default with `planning: true` + `utilityModel` (`planner: false` opts out): `decompose` + `validate` + `load` for a new objective (a person's turn or a delivered event/job/delegation signal), plan appended as an `execution-plan` signal; **per-goal tool lists enforced at execution time**; `update_goal` FAILED → automatic `replan` on `replanModel` (frontier) while the budget allows, else `utilityModel` | ✅ `planner` option: decompose before the first turn, `replan` on failure |
| Dual-loop critic | `Critic` (`cognition/critic.ts`, `as_reflections`): fingerprint, repeat ≥ 3 → "FORBIDDEN" intercept | ✅ inside the response: a failed guarded call (`error` / `invalid_arguments` / `denied`) gets the critique appended to its own result, with the real error and masked args; `useAgentFinish` only critiques failed non-guarded calls (Flue's `task`) | ✅ on `error` / `invalid_arguments` / `denied`, with real error + args |
| Executive monitor / drift sentinel (cosine < 0.55 or ALIGNED/DRIFTED) | `DriftSentinel` (`cognition/drift.ts`): embedder first, then model | ✅ the scratchpad's **current focus** against the objective, every `drift.everyTurns` (3) model turns once the focus moved (or while it stays drifted); anchor appended to the tool result mid-response, or a `drift-anchor` continuation at the finish (skipped while awaiting a human or halted). `utilityModel` or `drift.embedder` | ✅ every `driftCheckEvery` (5) turns, with an embedder if given |
| Scratchpad compactor | `ScratchpadCompactor` (`memory/scratchpad.ts`) | ✅ on by default (`scratchpad: false` opts out): every guarded tool result (ok or failed) is folded into the frame before the next model call (`utilityModel`, else a deterministic merge); the frame is rendered each turn as `[WORKING MEMORY]`, wrapped as untrusted data | ✅ after every tool batch |
| Sliding summary window | Flue compaction on `cloudflare/@cf/openai/gpt-oss-20b` (`compactionFor`) | ✅ default: compaction triggers once the context passes `triggerTokens` (48k, via `reserveTokens` when the model window is known: 224k reserve on gpt-6.1-terra) and keeps `keepRecentTokens` 10k (about the last three raw tool outputs) verbatim | `ContextWindow` (`keepRecentToolResults` 3) |
| Arguments auto-healer | `ArgumentHealer` (`tools/healer.ts`) | ✅ `utilityModel` is the repair model; `argumentHealing: "lenient"` (the default) lets constraint violations reach it | ✅ with `utilityModel` as the repair model |
| Confidence / risk matrix | `AutonomyGateway` (`autonomy/gateway.ts`) | ✅ tiers; an optional `_confidence` argument on every non-LOW tool by default (`confidence: false` opts out) | ⚠️ tiers yes; confidence never supplied |
| Safety fallback (`[CLEANSED_INJECTION_ATTEMPT]` → abort) | `containsCleansedMarker`, `UNTRUSTED_CONTENT_POLICY` | ✅ `halt_job` tool + forced lock on the marker in any input or tool result (`safetyFallback`, default on) | — |
| Deterministic FSM | `StateMachine`, `createJobStateMachineDefinition` (`cognition/fsm.ts`, `as_fsm`) | ✅ `workflow:` → render-time filter + `transition_state` + execution-time gating (fresh state per call; batch runs in order) | ✅ visibility filter **and** execution-time `policy` |
| Recovery state machine | `RecoveryManager` (`reliability/recovery.ts`) | via Flue `durability` + heartbeat sentinel | call it in your own steps |

`AgentRuntime` (`packages/core/src/runtime/agent-runtime.ts`) is the reference loop, with every module wired.
It runs anywhere: Node, tests, evals, custom DOs. Flue agents get the subset above through
`packages/flue/src/use-agent-starter.ts` and `packages/flue/src/cognitive-tools.ts`.

In a generated project, the `packages/<pkg>/src/...` paths live under `node_modules/@agent-starter/<pkg>/src/...`.

## Planning tools (`planning: true`)
- **`plan_goals { objective ≤ 300, goals: [{ id: /^[a-z0-9_]{1,40}$/, title ≤ 200, dependsOn?, riskTier? }] (1–12) }`.** It creates `root` (title = objective) if missing, adds `root.<id>` children with `dependsOn` mapped to `root.<dep>`, and sets root `ACTIVE`. It returns `{ tree, next }`.
- **`update_goal { goalId, status: ACTIVE | COMPLETED | FAILED | BLOCKED, result? ≤ 1000, spawnChildren? }`.** Children become `<goalId>.<child>`. An unknown `goalId` is a tool error that lists the known ids. If the update causes failures, the result includes a `replan` instruction: mark the branch BLOCKED and spawn alternatives under its parent, without abandoning root. With the planner on (the default) and a `utilityModel`, a FAILED goal is re-planned automatically instead (`Planner.replan`: prune the branch, spawn `<parent>.r<n>_<id>` alternatives, cap 3) and the result lists `replanned`.
- **Planner pre-pass (default with `planning: true`; `planner: false` opts out).** On a user turn, or a delivered task signal (`events`, `job`, `delegation`, `agent-message`, …), with no goal tree yet, `useAgentStart` asks `utilityModel` to decompose the objective (`Planner.decompose` → `validate`: unique ids, known deps, no cycles, tools from the agent's own tool list; the planner lists every tool a goal needs) and loads it; the tree is appended as an `execution-plan` signal. When the chat objective changes (below), the open plan is pruned and the new one gets its own root (`root2`, `root3`, …). Any planner failure falls back to `plan_goals`.
- **Per-goal tools (intent layer, R-COG-01).** While every actionable goal (PENDING/ACTIVE, dependencies done, no open children) names its tools, only their union may **change anything** (`GoalTree.allowedToolsNow()`, checked in the executor policy after FSM gating). Any other `write`/`external`/`destructive` tool is denied with "not in the plan for the current goal(s) …", and the critic tells the model to finish or fail the goal first. Read-only tools (`none`/`read`) stay free, as do built-ins, `halt_job` and `terminates-turn` tools (`ask_person`); a goal with no tool list, or no plan, restricts nothing; an approved call resumed by `tool-approval` is not re-gated. `render()` shows `tools=` per goal.
- **Re-planning model.** `replanModel: () => ModelProvider` (e.g. core `OpenAIResponsesProvider` on gpt-6.1-terra, the spec's re-planner) is used while at least `replanMinBudgetShare` (0.25) of the cost limit is left; otherwise, and when unset, `utilityModel` re-plans.
- **`GoalTree` semantics:**
  - `FAILED` increments `retryCount`. Once retries exceed `maxRetries` (2), meaning the 3rd failure, the parent is marked FAILED too, recursively.
  - `COMPLETED` cascades to the parent once every sibling is COMPLETED or PRUNED.
  - `next()` returns the first actionable PENDING/ACTIVE leaf whose dependencies are COMPLETED, preferring ACTIVE.
  - `prune(id)` marks a subtree PRUNED.
- **Render.** With goals present, `tree.render()` is injected as an instruction (`[ACTIVE HIERARCHICAL GOAL TREE]`). With none, the hint "For multi-step work, call plan_goals first, then update_goal after each step." is injected instead.
- Planning tools are always mounted, even in workflow states, and they are LOW/`none` so they never need approval.

## Reflection and self-critique limits
- **Critic (inside the response, spec "before hitting the LLM again").** When a guarded call fails (`error`, `invalid_arguments`, or `denied` other than a halt), the wrapper runs `Critic.reflect` with the real outcome text and masked args (on `utilityModel` if set, deterministic critiques otherwise), persists it to `as_reflections`, and appends the intercept (`[⚠️ CRITICAL REFLECTION INTERCEPT] … Critique: …`) to that call's error result. The model reads it on its very next turn. At most `maxReflectionsPerResponse` (default **2**) critiques per response. Failed calls of non-guarded tools (Flue's `task`) are still critiqued in `useAgentFinish` as a `critic-reflection` continuation.
- **Drift.** `checkDrift` compares `ScratchpadCompactor.current().currentFocus` with the objective (`DriftSentinel`: `drift.embedder` cosine first, else `utilityModel` ALIGNED/DRIFTED). It runs after a guarded tool result and at the finish of a response with tool calls, at most once every `drift.everyTurns` (3) model turns, and only once the focus has moved since the last check (or while the last verdict was drifted); state in `as_runtime_meta` `drift:<runId>`. A drifted verdict appends the anchor ("COGNITIVE ALIGNMENT SENTINEL") to the tool result, or at the finish as a `drift-anchor` continuation, and logs a `cognitive` telemetry event. Needs the scratchpad (`drift: false` opts out).
- **Reset.** Finish-time continuations (output guardrail, non-guarded critic, drift) share the `as:reflections` counter, which resets to 0 when a response finishes with no reflection. With the in-result critique cap, `maxReflectionsPerResponse` bounds both the critiques and the **extra model cycles per response** spent on self-critique.
- **Repeat failures.** The same action fingerprint failing ≥ 3 times gives "[⛔ REPEATED FAILURE INTERCEPT] … You are FORBIDDEN from calling it this way again". Budgets remain the hard stop (`agent-starter-models-and-cost`).
- **Objective source.** `initialData.objective` (background jobs set it), or else the first user message, truncated to 400 chars and stored in `as:objective`. In chat it follows the conversation: a later substantive message (≥ 24 chars, not a greeting) replaces it when `utilityModel` says it starts a NEW task (without a model: once no plan is open). Follow-ups and confirmations keep it. A new objective resets the drift baseline. It appears on one line in `[RUN CONTEXT]` (left out of cache keys).

## FSM workflows
```ts
const JOB_WORKFLOW = createJobStateMachineDefinition({ ingest: [...], evaluate: [...], execute: [...], report: [...] });
useAgentStarter({ ...platform("background-worker", id), tools, workflow: JOB_WORKFLOW, planning: true });
```
- `MachineDefinition<S, C> = { id, initial, states: Record<S, { instructions, tools: string[], transitions: Partial<Record<S, true | (ctx) => boolean>>, terminal? }> }`.
- `createJobStateMachineDefinition` builds `INGEST → EVALUATE → EXECUTE ↔ EVALUATE → REPORT → DONE`, with `FAILED` reachable from every non-terminal state:
  - EVALUATE must not mutate;
  - DONE has no tools;
  - FAILED may use the report tools.
- **Render time (Flue).** The state is loaded from `as_fsm` (key `<definition.id>:<conversationId>`). Only the tools listed for the current state are mounted, plus the built-ins, and `machine.render()` is injected: state, instructions, available tools, allowed next states.
- **`transition_state { to, reason }`.** Only declared transitions succeed (guards may check context). Anything else → `INVALID_STATE_TRANSITION`, returned to the model as a tool error.
- **Execution time.** The executor `policy` re-reads the machine from SQL on every call and rejects tools outside the active state, even names the model was shown earlier. Flue re-renders before every model call (so the next turn only sees the new state's tools), and workflow agents run a batch's tool calls in order, so `[transition_state, old_tool]` in one batch denies `old_tool`. Your own `policy` option runs after the state check.
- `AgentRuntime` also nudges the model to `transition_state` when it stops in a non-terminal state (first 3 turns), and ends the run on a terminal state.

## Autonomy tiers and confidence
**Mandated defaults** (spec "Mandatory Foundation Compliance Checklist"; every agent gets them, opt out per option):
`planner` (with `planning`), `scratchpad`, `confidence`, `argumentHealing: "lenient"`, low-trigger compaction with a
three-output recent window, and `model.routeWithUtilityModel` whenever `utilityModel` is set. Agents without a
`utilityModel` still get the deterministic scratchpad merge, the confidence field, lenient schemas (programmatic
healing only) and compaction; planner and utility routing need the utility model.

`useAgentStarter({ autonomy: Partial<AutonomyPolicy> })`:
- `confidenceThreshold` (0.85), `maxAutonomousTier` (`MEDIUM`);
- `autonomousAllowlist` (audited exceptions; may include HIGH tools, never CRITICAL);
- `forbidden` (never allowed, even with approval).

`forTenant(TenantConfig)` takes the **stricter** of agent and tenant settings: the higher threshold and the lower
ceiling, and the tenant's settings apply from the first tool call of a conversation (loaded at execution time).
The decision order is in `agent-starter-tools-and-firewall`. Confidence (default on; `confidence: false` opts out):
every non-LOW tool gets an optional `_confidence` (0–1) argument (described to the model, stripped before the
tool runs); a value below the threshold parks the call (`LOW_MODEL_CONFIDENCE_INTERCEPT`). Omitted = 1.0. Tune
autonomy with risk tiers, `maxAutonomousTier: "LOW"` (approve every mutation), or `requiresApproval`.

## Subagents, deep research and long-horizon work
- **Subagents.** `useSubagent({ name, description, agent, model?, thinkingLevel? })` (Flue). The model delegates through the built-in `task` tool, and several `task` calls in one turn run in parallel.
  - A subagent sees only its prompt and returns a final answer. Don't export its function, or it becomes a top-level agent.
  - It inherits the parent's model and reasoning unless overridden. For cheap fan-out, set a cheaper model already used in the project, e.g. `model: "cloudflare/@cf/moonshotai/kimi-k2.6"` (from the default fallbacks).
  - `useAgentStarter` is for **root agents only**, so subagents get no guarded tools. Keep them tool-less (research over the context you pass) or read-only. Do tool work, and anything mutating, in the root agent.
  - Their model turns are metered into the parent's budget ledger (Flue reports them under the parent instance with a `taskId`), so `maxTurns` / `maxCostUsd` cover fan-out too.
  - Examples: `src/agents/orchestrator.ts` (researcher + critic), `src/agents/coder.ts` (reviewer).
- **Deep research pattern:**
  1. `plan_goals` with one sub-goal per question.
  2. Fan out `task` calls to a researcher subagent, passing the sources the root fetched with `fetch_url_markdown` / `search_help_center`.
  3. Ask a critic subagent to review the synthesis.
  4. `update_goal` after each step.
  5. Save the report with `save_artifact`.

  For multi-perspective debate between stateful specialists, use a room instead (`agent-starter-multi-agent`).
- **Long-horizon pattern (background jobs):**
  - FSM workflow + `planning: true` + `memory: true`;
  - budget ceilings (`budget: { maxTurns, maxCostUsd, maxToolCalls }`);
  - `durability: { maxAttempts, timeoutMs }` on the agent function;
  - heartbeats to the run registry (the sentinel sends a `recovery` signal for stalled runs);
  - `initialData.objective` for drift anchoring;
  - artifacts and webhooks out at REPORT.

  See `src/agents/background-worker.ts` and `agent-starter-background-jobs`.

## Recipes
See [references/recipes.md](references/recipes.md):
- a custom FSM;
- execution-time business rules (`policy`) on top of FSM gating;
- tuning reflection, drift and autonomy;
- subagents for deep research;
- `AgentRuntime` with the intent `Planner` and the full cognitive stack.

Module internals: [references/cognitive-modules.md](references/cognitive-modules.md).

## Checklist (spec requirements; each with its proof)
- [ ] **Deterministic FSM:** the model reasons within the active state and cannot invent paths, and undeclared transitions fail. Verify: `memory-cognition.test.ts` "enforces explicit FSM transitions" and `runtime.test.ts` "locks the model into FSM states and only exposes the active state's tools".
- [ ] **Execution-time gating:** a tool outside the active state is rejected even if called. Verify: `AgentRuntime` FSM test and flue `hook-guards.test.ts` "denies old-state tools at execution time right after transition_state in the same batch".
- [ ] **Hierarchical plan before acting:** multi-step work starts with `plan_goals`, and the tree persists in SQLite across hibernation. Verify: `flue-e2e.test.ts` shows `plan_goals`/`update_goal` mounted, plus an `as_goal_tree` row check after a planning run.
- [ ] **Failure bubbling and re-planning without dropping root:** repeated child failures bubble to the parent, and the agent spawns alternatives. Verify: `memory-cognition.test.ts` "bubbles repeated child failures to the parent and finds the next actionable goal". `update_goal` returns a `replan` instruction.
- [ ] **Validated plans (cycles, dependencies, tool allowlists):** `Planner.validate` rejects cycles and unknown deps. Verify: "rejects cyclic plans and loads valid ones"; Flue pre-pass + automatic re-planning: `hook-capabilities.test.ts` "pre-plans a new objective, re-plans failed goals, critiques the real error and keeps a scratchpad".
- [ ] **Intent layer limits the sub-graph:** per-goal tool lists gate side effects at execution time. Verify: flue `hook-round3.test.ts` "denies a side effect the active goals did not plan for, keeps reads free, and runs the planned tool"; core `round3.test.ts` "allows the union of the actionable goals' tools…".
- [ ] **Re-planning on the frontier model when affordable.** Verify: flue `hook-round3.test.ts` "re-plans a failed goal on replanModel, and on the utility model once the budget share is not available".
- [ ] **Critic on failure, with a forced pivot before the next attempt:** a tool error's own result carries the critique (real error + args) in the same response, persisted to `as_reflections`. Verify: flue `hook-round3.test.ts` "appends the critic's pivot to the failed call before the model's next attempt, in the same response"; `hook-capabilities.test.ts` checks `as_reflections.observed_error`; repeat ≥ 3 shows the FORBIDDEN intercept (`Critic` unit test).
- [ ] **Bounded self-critique:** critiques and reflection/drift cycles per response ≤ `maxReflectionsPerResponse`. Verify: a test with an always-failing tool gives ≤ 2 critiques per response.
- [ ] **Drift sentinel anchors to the root objective on the scratchpad focus, at a turn cadence.** Verify: flue `hook-round3.test.ts` "checks the current focus against the objective at a turn cadence and anchors inside the tool result" and "replaces the chat objective when a message starts a new task, and keeps it for follow-ups"; core `memory-cognition.test.ts` "detects drift with embeddings".
- [ ] **Confidence / risk matrix:** HIGH → approval; non-LOW below 85 % confidence → approval; tenant ceilings apply. Verify: `tools.test.ts` "downgrades autonomy when model confidence is low" and "parks HIGH-risk tools…"; Flue: `hook-capabilities.test.ts` "pauses a risky call for approval when the model reports low confidence".
- [ ] **Mandated defaults without opt-in:** planner pre-pass, lenient healing, utility routing, confidence field and per-result scratchpad folding all work with no flags. Verify: flue `hook-guarantees.test.ts` "plans, heals leniently, routes with the utility model and folds every tool result into the scratchpad — without opting in".
- [ ] **Sliding summary window:** compaction starts early on the cheap model and keeps about three raw tool outputs. Verify: `hook-guarantees.test.ts` "compacts early on a cheap model and keeps about three raw tool outputs (sliding window)".
- [ ] **Safety fallback:** the cleansed marker aborts the job through `halt_job`, and nothing else can run. Verify: `hook-guarantees.test.ts` "stops on [CLEANSED_INJECTION_ATTEMPT] in a delivered event…".
- [ ] **Budgets stop loops mid-response, subagents included:** model usage is metered per model turn. Verify: `hook-guarantees.test.ts` "stops a tool loop inside ONE response…" and "meters Flue subagent (task) turns into the parent's ledger".
- [ ] **Ephemeral subagents for parallel fan-out:** subagents are not exported, are declared with `useSubagent`, and get no mutating tools. Verify: code review of `src/agents/*.ts`, plus `task_start` telemetry ("Subagent task started").
- [ ] **Long-running jobs survive restarts:** goal tree, FSM state, reflections and objective live in DO SQLite / persistent state. Verify: restart a job mid-run (abort + recovery signal) and confirm it resumes in the same FSM state and goal.

## Pitfalls
- **Workflow agents run tool batches sequentially** (that is what makes execution-time FSM gating deterministic). Keep slow tools out of workflow agents or accept the latency.
- **Self-reported confidence is a hint, not a control:** a model can over-report. Keep honest risk tiers and approvals as the real gate; `confidence` only adds pauses.
- **Planner pre-pass costs one utility-model call per new objective** and replaces the model's own first `plan_goals`. Set `planner: false` for chatty agents that still want `planning` tools.
- **The scratchpad folds every tool result:** with a `utilityModel` that is one cheap call per tool result (calls in one batch share a fold when they finish together). Set `scratchpad: false` on latency-critical agents (voice) if the deterministic merge is not enough; facts are rendered as untrusted data and instruction-like lines are dropped.
- **Lenient schemas are the default:** the model sees constraints in descriptions, not as JSON Schema keywords. Tools whose providers need exact strict-mode schemas (OpenAI strict function calling) can opt out with `argumentHealing: "strict"`.
- **Drift sentinel cost:** at most one utility call (or one embedding) per `drift.everyTurns` model turns, and none while the focus does not move. Objective tracking adds one utility call per substantive chat message once an objective exists.
- **Per-goal tool lists can block side effects the planner did not foresee:** the denial tells the model to finish or fail the goal (then re-planning adds goals with their own tools). Reads are never blocked. If an agent's goals routinely need mutating tools the planner omits, set `planner: false` and let the model plan with `plan_goals` (no tool lists, nothing gated).
- **Critique in tool results needs nothing from the finish hook:** do not add your own `useAgentFinish` critic for guarded tools, or the model gets two critiques per failure.
- **No `plan_goals` validation:** the model-authored `plan_goals` path takes the plan as-is: no cycle check, and `dependsOn` may name unknown ids, which then never complete. Prefer the planner pre-pass (validated; on by default with a `utilityModel`) or keep goal lists short.
- **Workflow ids are permanent:** state is keyed by `definition.id` plus the conversation id. Renaming the definition id resets every running workflow, and renaming a state orphans persisted rows (`load()` ignores unknown states).
- **Approvals vs autonomy:** `autonomousAllowlist` overrides `HIGH` approval. Every entry is an audited exception, and CRITICAL is always approved regardless.
- **Subagent tools are unguarded:** never give a subagent raw `useTool` side effects. They bypass the firewall, approvals and budget.

## Verify
```bash
pnpm --filter @agent-starter/core test   # memory-cognition (goal tree, planner, FSM, drift), runtime (FSM gating, approvals), tools (autonomy)
pnpm --filter @agent-starter/flue test   # flue-e2e: planning tools mounted, guarded tools
# generated app
pnpm test && pnpm evals                  # trajectory assertions on tool order / FSM states
```

## Related skills
`agent-starter-tools-and-firewall` (gateway decisions, approvals) · `agent-starter-memory-and-context`
(scratchpad, compaction) · `agent-starter-models-and-cost` (budgets, utility models, recovery) ·
`agent-starter-background-jobs` (heartbeats, recovery signals) · `agent-starter-multi-agent` (rooms vs subagents)
· `agent-starter-definition-of-done`.

## Not yet implemented
- **Model confidence in `AgentRuntime`:** only the Flue hook supplies a confidence; `AgentRuntime` never passes one.
- **Exact "last 3 tool outputs" window in Flue:** Flue owns the transcript, so the window is token-based (`keepRecentTokens`) through Flue compaction plus the per-result scratchpad, not an exact count of tool results.
- **`plan_goals` validation:** the model-authored path skips `Planner.validate` (cycles, unknown deps) and records no tool lists; only the `planner` pre-pass is validated and gated. No per-event-type `IntentPolicy` in the hook.
- **Frontier re-planning by default:** the hook only has Flue model specifiers, not a `ModelProvider` for the primary model, so frontier re-planning needs `replanModel` (a generated app passes one when it has an OpenAI key); without it `utilityModel` re-plans (deliberate deviation from spec L3887, documented).
- **Guarded tools in subagents:** `useAgentStarter` is root-only, and there is no guarded tool mounting for subagent renders.
