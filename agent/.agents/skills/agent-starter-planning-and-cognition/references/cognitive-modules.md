# Cognitive modules: internals and defaults

All tables live in the conversation's Durable Object SQLite. They are created by `CORE_MIGRATIONS`
(`packages/core/src/storage/schema.ts`).

| Module | Table | Key defaults | Injected text |
|---|---|---|---|
| `GoalTree` | `as_goal_tree (run_id, id, parent_id, tenant_id, title, status, risk_tier, retry_count, depends_on, allowed_tools, result)` | `maxRetries` 2 (the 3rd failure bubbles); ids `/^[A-Za-z0-9_.:-]{1,120}$/` | `[ACTIVE HIERARCHICAL GOAL TREE]` with `- [STATUS] id: title (risk X deps=…) → result` |
| `Planner` | (loads into `as_goal_tree`) | ≤ 12 goals; snake_case ids; `maxReplans` 3; re-plan ids `<parent>.r<n>_<id>` | `[🔄 RE-PLANNING] Pruned "<id>". <rationale> Spawned: …` |
| `Critic` | `as_reflections (run_id, step_name, executed_action, observed_error, critic_evaluation, pivoted_strategy, fingerprint)` | fingerprint = sha256(action + args)[0:24]; escalates at repeat ≥ 3; model max 300 tokens, temperature 0.3 | `[⚠️ CRITICAL REFLECTION INTERCEPT] … Requirement: abandon the previous approach …` / `[⛔ REPEATED FAILURE INTERCEPT] … FORBIDDEN …` |
| `DriftSentinel` | — | threshold 0.55 (cosine); model fallback answers `ALIGNED` / `DRIFTED` (4 tokens); errors → aligned | `[🚨 COGNITIVE ALIGNMENT SENTINEL] … Core objective … Current tactical drift …` |
| `ScratchpadCompactor` | `as_scratchpad (run_id, current_focus, facts_established, failed_attempts, next_planned_action)` | raw logs truncated to 12 000 chars; facts ≤ 40, failed ≤ 20; deterministic merge when there is no model | `[WORKING MEMORY SCRATCHPAD] - Active focus … - Known blocked paths (do not repeat) …` |
| `ArgumentHealer` | — | strategies: parse → `repairJsonText` (fences, single quotes, unquoted keys, trailing commas, truncation) → coercion → `repairModel` | tool error `TOOL_VALIDATION_FAILED` with issues + hint |
| `AutonomyGateway` | — | threshold 0.85, ceiling `MEDIUM`; CRITICAL always approval | `PENDING_APPROVAL` tool result |
| `StateMachine` | `as_fsm (machine_id, state, context_json, history_json)` | history keeps the last 100 transitions | `[WORKFLOW STATE: X] <instructions> Tools available in this state: … Allowed next states: …` |
| `RecoveryManager` | `as_recovery_state (scope, state, retry_count, last_error)` | `maxRetries` 3; backoff 1 s × attempt | throws `RECOVERY_EXHAUSTED` `[CRITICAL_HALT] …` |

## Defaults that matter in `useAgentStarter`
- `maxReflectionsPerResponse`: 2. It caps the in-result critiques per response, and the finish-time continuation cycles (non-guarded critic, drift, output guardrail), which reset after a clean response.
- The objective is `initialData.objective`, or else the first user message (400 chars), replaced by a later chat message that starts a NEW task (utility model). It is persisted in `as:objective`.
- Drift: `drift.everyTurns` 3, on the scratchpad's `currentFocus`, only after the focus moved; `drift.embedder` optional (cosine, threshold 0.55).
- Per-goal tool lists (`allowed_tools`) gate execution while every actionable goal has one.
- Planning hint when there are no goals: "For multi-step work, call plan_goals first, then update_goal after each step."
- Workflow and planning tools are always mounted. User tools are filtered by `machine.allowedTools()`.
- Critic and drift run on `utilityModel()` (drift also on `drift.embedder`). Without them, the critic uses deterministic critiques and the drift check is skipped. Critiques ride on the failed tool's result; halts are never critiqued; drift is skipped while the run awaits a human or is halted.
- Defaults (opt out per option): `planner` (with `planning`), `scratchpad` (every tool result folded before the next model call), `confidence`, `argumentHealing: "lenient"`, compaction `{ model: gpt-oss-20b, triggerTokens: 48000, keepRecentTokens: 10000 }`, `routeWithUtilityModel` when a `utilityModel` exists, `safetyFallback` (`halt_job`).
- Budgets are metered per model turn (subagent `task` turns included) through a process-wide `observe()` meter keyed by the conversation id, idempotent per `turnId`; the response finish records only what the turns did not cover.

## Defaults in `AgentRuntime`
- `contextTokens` 60 000 (`ContextWindow`).
- `maxToolsPerTurn` 16 (`maskTools`, `alwaysInclude: transition_state, update_goal, remember_fact`).
- `driftCheckEvery` 5 turns. The focus comes from the scratchpad's `currentFocus`.
- The critic runs on every `error` / `invalid_arguments` / `denied` outcome, with the real error text and args.
- FSM nudge: while the workflow is non-terminal and not `REPORT`, for the first 3 turns, "Use transition_state to advance…".
- The planner decomposes before the first turn when the tree is empty. A failed `update_goal` calls `planner.replan`, counting existing `.r<n>_` ids against `maxReplans`.

## Spec mapping notes
- The spec's "Executive Monitor" is the `DriftSentinel`. The spec uses `@cf/baai/bge-small-en-v1.5` with a 0.55 baseline. `WorkersAIEmbedder` defaults to bge-base (768 d); pass `new WorkersAIEmbedder(env.AI, "@cf/baai/bge-small-en-v1.5")` to match the spec. A drift embedder does not need to match the Vectorize index dimensions.
- The spec's `PlanOrchestrator.handleStepFailureAndReplan` is `Planner.replan`. It prunes the failed subtree, spawns 1–5 alternatives under the **parent**, and re-activates the parent.
- The spec's risk matrix has 3 tiers. The code adds `CRITICAL`, which always requires approval and is used for irreversible deletes.
- The spec's "freeze and surface an oversight card" maps to an `approval` telemetry event (`status: PENDING_APPROVAL`) plus the `approval` data part. The React `HumanOversightCard` renders it (`agent-starter-generative-ui`).
