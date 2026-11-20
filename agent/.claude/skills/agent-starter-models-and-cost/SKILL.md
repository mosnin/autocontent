---
name: agent-starter-models-and-cost
description: Choose, route and pay for models in an Agent Starter project — the default openai/gpt-6.1-terra at medium reasoning and registerExtendedModels, primary/fallback chains with the provider-health circuit, first-line Workers AI routing (routeSimpleToFirstLine), the cheap compaction model, ModelRouter profiles/classify/route for core and utility calls, OpenAI/Workers AI/OpenAI-compatible providers, Cloudflare AI Gateway, prompt and semantic caching, BudgetGuard and the cost ledger, tenant limits from TenantConfigProvider, retries, circuit breakers, recovery and model health. Use when changing models, fallbacks or reasoning effort, adding a provider, routing through AI Gateway, setting or debugging budgets and cost, or handling provider outages and rate limits.
---

# Models and cost

## When to use
- Changing the default model, fallbacks, first-line model, compaction model or reasoning effort.
- Adding a provider (OpenAI account, AI Gateway, Groq/OpenRouter/vLLM), or making utility calls through `ModelRouter`.
- Setting per-tenant or per-agent budgets, reading the cost ledger, or explaining a "BUDGET EXHAUSTED" reply.
- Provider outages, 429s, timeouts, retries and circuit breakers.

## Mental model: two model planes

| Plane | Who calls the model | Selection | Accounting |
|---|---|---|---|
| **Flue agent loop** (every `src/agents/*.ts`) | Flue harness via `useModel(specifier, { thinkingLevel, compaction })`, called by `useAgentStarter` | `AgentStarterModelOptions` + `modelHealth` circuit + budget/first-line rules, decided **at render, per submission** | `useResponseFinish` → `BudgetGuard.recordTurn()` + `recordModelUsage(model, usage, response.usage.cost.total)` |
| **Core / utility** (critic, drift, injection classifier, re-ranking LLM, `AgentRuntime`) | `ModelProvider`s (`WorkersAIProvider`, `OpenAIResponsesProvider`, `ChatCompletionsProvider`), optionally behind `ModelRouter` | `ModelRouter` profiles, fallback chains, `allowedProfiles`, `classify`/`route` | `ModelRouter` → `budget.recordModelUsage` when a `BudgetGuard` is attached (`AgentRuntime` does this) |

Code owners:
- `packages/flue/src/use-agent-starter.ts`: model selection, ledger writes, budget exhaustion.
- `packages/flue/src/models.ts`: `registerExtendedModels`, `EXTENDED_OPENAI_MODELS`, the Flue-plane caches (`withModelCache`, `ModelCacheOptions`, `installModelScope`, `resolveModelCacheScope`).
- `packages/flue/src/runtime.ts` (`modelHealth`, `providerOf`) and `observer.ts` (feeds the circuit).
- `packages/core/src/models/`: `router.ts`, `types.ts`, `cache.ts`, `structured.ts`, `providers/openai.ts`, `providers/openai-compatible.ts`.
- `packages/core/src/budget/budget.ts`: `BudgetGuard`, `CostModel`, `DEFAULT_PRICING`.
- `packages/core/src/reliability/`: `retry.ts`, `circuit-breaker.ts`, `recovery.ts`.
- `packages/cloudflare/src/workers-ai.ts`: `WorkersAIProvider`, `aiGatewayBaseUrl`, `aiGatewayHeaders`.
- Generated app: `src/lib/platform.ts` (`modelOptions()`, `utilityModel`, `tenantConfigs`), `src/app.ts`, `wrangler.jsonc` vars.

In a generated project, the `packages/<pkg>/src/...` paths live under `node_modules/@agent-starter/<pkg>/src/...`.

## Defaults (and where to change them)
| Setting | Default | Change via |
|---|---|---|
| Primary | `openai/gpt-6.1-terra`, `thinkingLevel: "medium"` | `AGENT_MODEL` var → `modelOptions()`; per agent `model: { ...modelOptions(), primary }` |
| Fallbacks | `openai/gpt-5.5`, `cloudflare/@cf/moonshotai/kimi-k2.6` | `AGENT_FALLBACK_MODELS` (comma-separated) |
| First line | `cloudflare/@cf/meta/llama-3.1-8b-instruct` | `FIRST_LINE_MODEL` |
| Compaction | `cloudflare/@cf/openai/gpt-oss-20b`, `triggerTokens` 48 000, `keepRecentTokens` 10 000 | `model.compaction` (string, `{ model?, triggerTokens?, keepRecentTokens?, reserveTokens? }` or `false`) |
| Voice primary | `model.voice` ?? `firstLine`, `thinkingLevel: "off"` | `model.voice`; used when the delivery's server-stamped `channel` is `voice` (falls back to `initialData.scopes` containing `channel:voice`) |
| Semantic prompt cache (Flue plane) | off | `registerExtendedModels({ ..., semanticCache: { kv, embedder?, threshold = 0.96, ttlSeconds = 3600 } })` |
| AI Gateway response cache | off | `aiGatewayOpenAIHeaders({ cacheTtlSeconds })` in `modelGateway()` (`cf-aig-cache-ttl`) |
| Tenant model profiles | firstLine/voice → `"first-line"`, primary/fallbacks → `"frontier"` | `model.profiles` (specifier → profile); `TenantConfig.allowedModelProfiles` (`"*"` = all) |
| Utility model | `new WorkersAIProvider(env.AI)` (llama-3.1-8b) | `utilityModel` in `platform.ts` |
| Embeddings / re-ranker | `@cf/baai/bge-base-en-v1.5` (768 d) / `@cf/baai/bge-reranker-base` | `WorkersAIEmbedder(ai, model)`, `workersAICrossEncoder(ai, model)` |

`agent-starter.config.ts` (`defineAgentStarterConfig`) holds the model, budget and autonomy defaults. The generated
`platform.ts` reads them (`modelOptions()` from `config.models`, budget ceilings and `authorizedTools` through
`policy.ts`, `autonomy` thresholds); `wrangler.jsonc` vars (`AGENT_MODEL`, …) override the models per deployment, and
tenant KV config sets the per-tenant limits.

**GPT-6.1 Terra** comes from `registerExtendedModels()`, which must run at the top level of `src/app.ts` or
Flue fails with "Unknown model ID". Its entry in `EXTENDED_OPENAI_MODELS` (`packages/flue/src/models.ts`):
- `openai-responses` API, reasoning on, text + image input;
- 272 000-token context, 128 000 max output;
- USD per 1M tokens: input 1, output 5, cache read 0.05, cache write 1.25. Above 272k input tokens the rates are 2 / 7.5 / 0.1 / 2.5;
- `thinkingLevelMap`: `off→none`, `minimal→unsupported`, `low`, `medium`, `high`, `xhigh`, `max`.

Pin `@earendil-works/pi-ai` and `pi-agent-core` to **1.4.0**: Flue 2.3.0 breaks on 1.5.0.

## How the Flue model is chosen (each submission)
```
candidates = [voice ? (model.voice ?? firstLine) : primary, ...fallbacks]
model = first candidate whose PROFILE the tenant allows (allowedModelProfiles) AND whose PROVIDER circuit is closed  ?? firstLine
if budgetExhausted                                     → model = firstLine (graceful "limit reached" reply, no tools)
else if (chat user turn || a signal carrying a stamped route) && the tenant allows firstLine:
  attributes.route === "SIMPLE" (agentAuth's classify, or the server on a dispatched job/event) → model = firstLine
  route === "COMPLEX"                                  → keep the primary
  routeSimpleToFirstLine && isSimpleMessage(body)       → model = firstLine
  routeWithUtilityModel (default: on when utilityModel is set) && conversation SIMPLE && short → model = firstLine
useModel(model, { thinkingLevel: voice ? "off" : thinkingLevel ?? "medium", compaction })
→ useAgentStart writes one as_router_log row per submission (routed_to, profile, reason)
```
- **Tenant profiles (R-MOD-09).** An unconfigured tenant (`SECURE_DEFAULT_TENANT_CONFIG`, `["first-line"]`) is answered by the first-line model; a tenant whose config allows `"frontier"` gets the primary. The render runs before the config loads, so the first submission of a new conversation uses (in order) the per-isolate config cache, the stored config, `initialData.tenantConfig` (a trusted server seed, e.g. from `agentAuth`'s `extraInitialData`), then the secure default.
- **Per-delivery routing.** `agentAuth({ classify })` classifies the incoming message at the edge and stamps `route` on the delivery (client-supplied `route`/`channel` are stripped), so the **current** submission uses the verdict. Server code does the same for the signals it dispatches (background jobs, events, room turns): classify the turn with the utility model (`ModelRouter.classify` or the edge `classify`) and put `attributes.route: "SIMPLE" | "COMPLEX"` on the signal; the hook honours a stamped route on **any** signal (clients can never set one) and logs `stamped route: <verdict>`. Without a stamp, `utilityModel` classifies each user message SIMPLE/COMPLEX in `useAgentStart` and logs it; Flue fixes the model per submission before start hooks run, so that verdict steers the **next** submission.
- **`modelHealth`** is a `CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 })` keyed by **provider** prefix (`openai`, `cloudflare`, …), one per isolate:
  - `installAgentStarterObserver()` records success or failure from every Flue `turn` event;
  - two consecutive failures open the circuit for 60 s, so the next submission skips **every** model of that provider;
  - mid-submission failures are not re-routed: the circuit changes the **next** submission's choice.
- **`isSimpleMessage`** matches short single-line greetings, thanks, ok/yes/no and "what can you do". It is a regex, not a classifier. `SupportAgent` turns it on.

## ModelRouter (core plane)
- **Construction.** `new ModelRouter({ profiles: Record<string, { provider, model?, reasoningEffort?, temperature?, label? }>, defaultProfile, fallbacks?: Record<profile, profile[]>, firstLineProfile?, frontierProfile?, allowedProfiles?, circuit?, retry?, budget?, tracer?, sql?, runId?, tenantId? })`.
- **`generate({ ...request, profile? })`** walks `chain(profile)`:
  - the chain is the profile plus its fallbacks, minus unknown profiles, filtered by `allowedProfiles` (`TenantConfig.allowedModelProfiles`). An empty chain → `MODEL_UNAVAILABLE`;
  - each target has a circuit key `provider:model` (threshold 3, cooldown 30 s) and gets `retry` with 2 attempts on retryable errors;
  - it stops on validation or budget errors and on abort;
  - a fallback hit is logged to `as_router_log`;
  - when every target fails it throws `MODEL_UNAVAILABLE` (retryable).
- **`stream()`** streams the first profile and falls back to a non-streamed `generate` on a mid-stream failure.
- **`route(task, { forceProfile? })`** is first-line routing: `classify(task, ["SIMPLE", "COMPLEX"])` on `firstLineProfile`. SIMPLE → first line, else frontier. Classifier errors → frontier. Decisions are logged to `as_router_log`, which feeds the routing-density KPI.
- **`classify(text, labels, { instructions?, fallback })`** sends ≤ 6000 chars with `temperature 0` and `maxOutputTokens 16`, returning a label or the fallback.
- **Other helpers:** `withContext({ budget, runId, tenantId, allowedProfiles, sql, tracer })` (shares the circuit), `singleProviderRouter(provider)`.

Providers:
- `OpenAIResponsesProvider({ apiKey, model = "gpt-6.1-terra", reasoningEffort = "medium", baseUrl?, organization?, project?, headers?, fetch?, id? })` uses `store: false`, a reasoning summary, `parallel_tool_calls`, and JSON-schema output. `DEFAULT_OPENAI_MODEL` and `DEFAULT_REASONING_EFFORT` hold the defaults.
- `ChatCompletionsProvider({ id, baseUrl, apiKey?, model, headers?, fetch? })` covers any OpenAI-compatible endpoint (Workers AI REST, AI Gateway compat, Groq, OpenRouter, vLLM, Ollama).
- `WorkersAIProvider(env.AI, { model?, gateway?: { id, skipCache?, cacheTtl?, metadata? }, id? })` accepts native or OpenAI-shaped results and maps capacity errors to 429 and timeouts to 408.

## AI Gateway and caching
- **AI Gateway for core providers:**
  - `baseUrl: aiGatewayBaseUrl(accountId, gatewayId, "openai")` plus `headers: aiGatewayHeaders({ cacheTtlSeconds, skipCache, metadata: { tenant, run }, gatewayToken, eventId })`;
  - for Workers AI: `new WorkersAIProvider(env.AI, { gateway: { id: "<gateway>", cacheTtl: 3600 } })`;
  - the gateway adds analytics, provider caching, rate limits and logging.
- **AI Gateway for Flue agent traffic:** `registerExtendedModels({ baseUrl: aiGatewayOpenAIBaseUrl({ accountId, gatewayId }), headers: aiGatewayOpenAIHeaders({ token, cacheTtlSeconds, metadata }) })` rewrites every OpenAI model's base URL (built-in and Terra) and adds the headers. Call it once at module top level in `src/app.ts`; calling again with different options re-registers. The generated `platform.ts` exposes `modelGateway()` for this.
- **Provider prompt caching** (OpenAI, automatic for repeated prefixes):
  - Flue's `usage.cacheRead` is recorded as `cachedInputTokens` and priced at `cachedInput` by `CostModel` ($0.05/M for Terra);
  - keep long instructions and skills **stable and first**, because `useInstruction` order is part of the prefix;
  - put volatile data (retrieval, app context) in signals or late instructions;
  - pi-ai sends the Flue session id as `prompt_cache_key`; core `OpenAIResponsesProvider` takes `request.promptCacheKey` or a `promptCacheKey(request)` default (clamped to 64 chars) — use a stable tenant-scoped key.
- **Semantic cache, Flue plane (R-MOD-07).** `registerExtendedModels({ ..., semanticCache: ModelCacheOptions, cacheScope?: "tenant" | "user" })` wraps the OpenAI provider with `withModelCache` (wrap other pi-ai providers the same way before `setProvider`):
  - `ModelCacheOptions`: `kv: () => KeyValueStore` (resolved per call), `embedder?: () => Embedder` (near-duplicates; without it exact hits only), `threshold` 0.96, `ttlSeconds` 3600, `models?`, `maxCandidates` 20, `tenantOf?`, `onEvent?` (hit / miss / store / bypass);
  - **partition (never cross-tenant):** a Flue execution interceptor (`installModelScope`, installed by `registerExtendedModels` when a cache is on) runs each model call in an AsyncLocalStorage scope carrying the agent instance id; the tenant (or tenant + encoded user with `cacheScope: "user"`) is parsed from that server-minted id, never from the prompt or the model. With no instance id, Flue's per-conversation affinity key (`options.sessionId`) partitions; with neither, the call is not cached;
  - **key:** partition + model + reasoning/sampling options + the normalized system prompt, tool set and history (timestamps, usage, response/tool-call ids, hidden reasoning and the per-conversation `[RUN CONTEXT]` line dropped) + the last user message. Exact match, or ≥ threshold cosine similarity on the last user message **with the same numbers/ids/emails** and the same history. The gateway cache key uses the same normalization;
  - **only final text answers are stored** (no tool calls, no errors, no truncation), and only turns whose last message is a plain user message are looked up, so a hit never replays a side effect. A hit costs nothing (`usage` zero, `responseId` `semcache_…`; the tracer marks `agent.semantic_cache_hit`);
  - storage: KV `semcache:v1:<hash>` (completion) and `semcache:v1:ctx:<contextHash>` (candidate embeddings, no Vectorize index needed).
- **Semantic cache, core plane.** `SemanticCache({ kv, embedder?, vectors?, threshold = 0.96, ttlSeconds = 3600, scope = "tenant" | "global", tenantId? })` + `CachedModelProvider(inner, cache)` for `ModelProvider`s: never caches requests with tools; tenant-scoped by default (`CONFIG_INVALID` without `tenantId`).
- **AI Gateway response cache.** With `cf-aig-cache-ttl` in the headers (`aiGatewayOpenAIHeaders({ cacheTtlSeconds })`), every Flue request also carries `cf-aig-cache-key = as-<sha256(partition + full request)>`, so gateway hits stay inside the tenant; a call with no partition gets `cf-aig-skip-cache: true`.

## Budgets and the cost ledger
- **`BudgetGuard({ runId, tenantId, limits, sql?, costModel?, onBreach?, clock? })`:**
  - `limits` is `BudgetLimits`: `maxTurns`, `maxCostUsd`, optional `maxTokens`, `maxWallClockMs`, `maxToolCalls`, `maxVmSeconds`;
  - the ledger table `as_budget_ledger` has rows of kind `turn` / `model` / `tool` / `vm`, keyed by `run_id`;
  - `breach()` checks turns, cost, tokens, tool calls, VM seconds and wall clock, in that order;
  - `check()` throws `BudgetExceededError` (`BUDGET_LIMIT_EXCEEDED`) and fires `onBreach` once;
  - other methods: `remaining()`, `recordTurn()`, `recordModelUsage(model, usage, costUsd?)` (estimated via `CostModel` when the cost is missing), `recordToolCall(cost)`, `recordVm(seconds, cost)`.
- **`CostModel(overrides?, fallback = "*frontier*")`:** `estimate(model, usage)` prices fresh input, cached input and output plus reasoning tokens. Use `set(model, pricing)` for contract rates. `DEFAULT_PRICING` covers Terra, gpt-5.5 and the Workers AI models used here.
- **In Flue agents:**
  - limits = `mergeLimits(tenantConfig, options.budget)`: the **stricter** of tenant and agent per field (`maxTurns` vs `maxTurnsPerSession`, `maxCostUsd` vs `maxBudgetUsd`, `maxTokens` vs `maxTokensPerSession`); an agent can tighten but never lift a tenant cap. Tool calls use the tenant config loaded at execution time;
  - the ledger key is the **budget scope**: the conversation id by default; `budgetScope: "submission"` starts a fresh budget (and firewall quota window) for every delivered message (`<id>#<n>`); a function returns a custom sub-key (e.g. a job id);
  - one `BudgetGuard` per render is reused by every tool call and hook of that render (snapshot cached in memory);
  - each response records one `turn` and one `model` row, deduped by `usage:<responseId>` in `as_idempotency`;
  - each successful tool call records a `tool` row;
  - at render, `breach()` → `budgetExhausted`: first-line model, **no tools**, and the "BUDGET EXHAUSTED" instruction;
  - before every tool call, `budget.check()` → `budget_exceeded` + `terminate`;
  - response metadata carries `budget: { turns, costUsd, tokens, maxCostUsd, maxTurns, maxTokens?, exhausted, scope }`, `usage`, `model`, `securityLocked`, `tenantLocked`, `voice`;
  - **breach (R-BG-07):** the first breach of a scope (tool `check()`, or detected after a response) fires once (`budget-breach:<scope>` in `as_idempotency`): `budgetBreach.snapshots()` gets `RunStore.stashSnapshot` under `tenants/<tenantId>/snapshots/<runId>/`, `budgetBreach.notifier()` alerts `budgetBreach.recipient(tenant)` (default: the approvals recipient), and an error telemetry event is emitted.
- **Tenant limits:**
  - `TenantConfigProvider({ kv, cacheTtlMs = 60 000, fallback?, keyPrefix = "config:" })`, reached as `tenantConfigs().get(tenantId)` in `platform.ts`;
  - a missing config → `SECURE_DEFAULT_TENANT_CONFIG`: 5 turns, $0.15, `allowedModelProfiles: ["first-line"]`;
  - a malformed config → lockdown;
  - updates arrive through the signed sync route (`agent-starter-security`).
- **`AgentRuntime`** wires `BudgetGuard` into `ModelRouter.withContext` and `ToolExecutor`. On breach it calls `RunStore.stashSnapshot(blobs, runId)` (R2 `snapshots/<run>/<ts>.json`) and `onBudgetBreach`, then halts with status `HALTED`.

## Retries, circuit breakers, recovery
- **`retry(fn, policy?, hooks?)`:** `DEFAULT_RETRY_POLICY` is 3 attempts, 500 ms base, 20 s cap, exponential with full jitter. It honours `Retry-After` and only retries `isRetryableError` errors: rate_limit, timeout, network, server, and `AgentError.retryable`. `HttpError` marks 408, 409, 425, 429 and 5xx as retryable.
- **`withTimeout(label, ms, fn, parentSignal?)`:** aborts the inner signal and throws `TimeoutError`.
- **`classifyError(e)`** returns one of `rate_limit`, `timeout`, `network`, `server`, `auth`, `validation`, `budget`, `approval`, `unknown`.
- **`CircuitBreaker({ failureThreshold = 5, cooldownMs = 30 000, halfOpenSuccesses = 1 })`:** keyed, with `execute`, `canRequest`, `recordSuccess`, `recordFailure`, and `state` → closed / open / half_open.
- **`RecoveryManager(sql, { scope, maxRetries = 3, classify?, strategies? })`:**
  - `executeWithRecovery(step, fn)` checkpoints the `FailureState` (`VM_UNREACHABLE`, `LLM_RATE_LIMIT`, `SANDBOX_TIMEOUT`, `TOOL_FAILURE`, `PAUSED_OVERSIGHT`, `CRITICAL_FAILED`) in `as_recovery_state`;
  - per-state `heal` and `backoffMs` hooks run between attempts;
  - when retries run out it throws `RECOVERY_EXHAUSTED` "[CRITICAL_HALT]".
- **Tool retries:** the `ToolExecutor` retries only `idempotent`, `read` and `none` tools. Flue agent durability (`Agent.durability = { maxAttempts, timeoutMs }`) re-runs interrupted submissions.

## Recipes
See [references/recipes.md](references/recipes.md):
- change models and fallbacks;
- per-agent overrides;
- AI Gateway for utility and core calls;
- a `ModelRouter` with tenant-allowed profiles;
- custom pricing;
- reading budgets from response metadata;
- a recovery-wrapped step;
- the semantic prompt cache and AI Gateway caching for Flue agents.

## Checklist (spec requirements; each with its proof)
- [ ] **OpenAI GPT-6.1 Terra at medium reasoning is the default.** Verify: `pnpm --filter @agent-starter/flue test` (`models.test.ts` "keeps built-in models and adds GPT-6.1 Terra"), plus `registerExtendedModels()` at the top of `src/app.ts`. Response metadata `model` is `openai/gpt-6.1-terra`.
- [ ] **Model router / fallback:** a provider outage moves to the next model instead of failing the turn. Verify: `runtime.test.ts` "falls back to a backup model when the primary provider is down" (`ModelRouter`). For Flue, two failed turns open `modelHealth` for the provider (unit-test `modelHealth.recordFailure("openai")` twice, then `canRequest` is false).
- [ ] **Workers AI as the first line:** cheap edge models handle simple turns, classification, compaction, critique, healing and injection second opinions; the frontier model is reserved for complex reasoning. Verify: `utilityModel` is a `WorkersAIProvider`, compaction is a `cloudflare/@cf/*` model, and `routeSimpleToFirstLine` is enabled where it suits. A "hi" turn returns metadata `model` = first line.
- [ ] **Hard budget circuit breakers:**
  - turns and cost are recorded locally at the end of every turn;
  - the run halts gracefully at the ceiling;
  - tools refuse once the budget is exhausted.

  Verify: `runtime.test.ts` "halts at the hard cost ceiling and stashes a snapshot", `tools.test.ts` "refuses tool calls once the budget is exhausted", `flue-e2e.test.ts` "records budget usage", and the eval "Token/Cost Cap Enforcement" (Promptfoo).
- [ ] **Breach snapshot to R2 plus an alert:** the final state is stashed for debugging and someone is notified, once. Verify: `runtime.test.ts` asserts the snapshot key; Flue: `hook-guards.test.ts` "stashes a tenant-scoped snapshot and alerts once on a budget breach".
- [ ] **Agent budgets never lift tenant caps; token caps enforced.** Verify: `hook-guards.test.ts` "merges agent and tenant budgets to the stricter value and enforces maxTokensPerSession".
- [ ] **Per-job budgets for background agents.** Verify: `hook-guards.test.ts` "gives each submission a fresh budget with budgetScope: submission".
- [ ] **Tenant `allowedModelProfiles` enforced (free tier → first line).** Verify: `hook-guards.test.ts` "restricts models to the tenant's allowedModelProfiles".
- [ ] **Voice channel model.** Verify: `hook-guards.test.ts` "switches to voice mode on the channel:voice scope".
- [ ] **Ledger survives eviction:** budget state is in DO SQLite, not memory. Verify: `runtime.test.ts` "BudgetGuard persists across instances (survives DO eviction)".
- [ ] **Tenant limits come from edge KV, with secure defaults and lockdown.** Verify: `security.test.ts` "falls back to secure defaults and locks down corrupted config"; `useAgentStarter` limits derive from `TenantConfig`.
- [ ] **AI Gateway** routes model traffic for analytics, caching and rate limits. Verify: core providers use `aiGatewayBaseUrl` / the `gateway` option; Flue: `models.test.ts` "rewrites every OpenAI model's base URL and adds gateway headers"; requests appear in the AI Gateway dashboard.
- [ ] **Semantic prompt cache on the Flue model path** (threshold 0.96, TTL 1 h) cuts duplicate spend, never stores tool calls and never crosses tenants. Verify: flue `model-cache.test.ts` "serves an exact hit to another conversation of the same tenant, never to another tenant", "serves near-duplicates only with the same history and the same numbers/ids", "never stores tool calls, and bypasses mid-loop turns and calls with no tenant or session scope", "reuses a tenant's answer across conversations and keeps tenants apart" (inside a real Flue runtime) and, with the hook's real system prompt, `hook-round3.test.ts` "serves a tenant's cached answer in another conversation although [RUN CONTEXT] differs". Core plane: `memory-cognition.test.ts` "serves semantic cache hits only for identical context", `fix-round-c.test.ts` "is tenant-scoped by default…".
- [ ] **AI Gateway caching is enabled and tenant-scoped.** Verify: `modelGateway()` passes `cacheTtlSeconds`; flue `model-cache.test.ts` "adds a tenant-scoped cf-aig-cache-key, and cf-aig-skip-cache when no scope is known"; cache hits show in the AI Gateway dashboard.
- [ ] **Retries with backoff only for transient errors; circuits fail fast and only count provider failures.** Verify: `runtime.test.ts` fallback test, `fix-round-c.test.ts` "does not open the circuit on 4xx validation errors…", plus code review that non-idempotent tools are not retried.
- [ ] **Recovery state machine** checkpoints the failure state and safe-stops after N attempts. Verify: a `RecoveryManager` unit test with a throwing step reaches `CRITICAL_FAILED` and throws `RECOVERY_EXHAUSTED`.
- [ ] **Cheap router on server-dispatched work:** a job/event signal stamped `route: "SIMPLE"` runs on the first-line model, `"COMPLEX"` on the primary. Verify: flue `hook-round3.test.ts` "runs a job signal stamped SIMPLE on the first-line model and COMPLEX on the primary".
- [ ] **Routing-density KPI** (share of first-line versus frontier turns) is reported. Verify: the daily efficiency report (`src/background/report.ts`) includes routing data; Flue agents write one `as_router_log` row per submission (`hook-guards.test.ts` "restricts models…" checks it) plus utility-classifier rows (`hook-capabilities.test.ts` "heals constraint violations…").

## Pitfalls
- **Unknown model ID:** `registerExtendedModels()` missing from `src/app.ts`, or called inside a handler, causes "Unknown model ID gpt-6.1-terra".
- **Per-provider fallbacks:** the circuit is **per provider**. A fallback on the same provider as the primary (`openai/gpt-5.5`) is skipped together with it during an OpenAI outage. Keep at least one fallback on a different provider (Workers AI).
- **Agent budgets can only tighten:** `options.budget` is merged with `Math.min` against the tenant's limits. To give an agent more room, raise the tenant's config (dev: `scripts/seed-dev-tenant.mjs`).
- **Budgets accumulate per conversation id by default:** queue-driven agents keyed per contact accumulate across every event and eventually stay exhausted. Use `budgetScope: "submission"` (or a job-id function) for per-event budgets.
- **Free tier = first-line model:** an unconfigured tenant is answered by `firstLine`. Seed tenant configs with `allowedModelProfiles: ["frontier", "first-line"]` (and seed `initialData.tenantConfig` server-side) or new conversations start on the first-line model.
- **Unmetered side calls:** utility-model, embedding, re-ranker and AI Search calls are **not** written to the ledger in Flue agents, so the ledger under-counts real spend.
- **First-submission render:** model choice and tool visibility of a brand-new conversation come from the render before the config loads (cache → stored → `initialData.tenantConfig` → secure default); tool execution always uses the freshly loaded config.
- **Per-isolate health:** `modelHealth` is per isolate and in memory. Different Durable Objects learn of an outage independently.
- **Effort is set per agent:** `thinkingLevel` applies to the whole agent. Lower it for chatty agents (`"low"`) rather than switching to a weaker model.
- **Model swaps:** when changing `primary` to a model outside Flue's catalog, add it to `EXTENDED_OPENAI_MODELS` (OpenAI) or verify the provider prefix resolves.
- **No semantic-cache hits:** anything volatile in the system prompt (a timestamp, a per-request id, the budget left) makes every context unique. The hook's own `[RUN CONTEXT] tenant=… user=… conversation=… objective=…` line is left out of the cache key (`RUN_CONTEXT_PREFIX`, `models.ts`): the partition already carries the tenant (or tenant + user), so a tenant's answer is reused across its conversations. Keep your own volatile data in signals after the user message, or accept a lower hit rate.
- **Semantic cache scope:** `"tenant"` lets a user receive an answer computed for a colleague when the system prompt, tools and history are identical. Use `cacheScope: "user"` when the prompt may depend on who asks in ways not visible in the context.
- **`registerExtendedModels` owns the cache wiring:** the tenant partition comes from the execution interceptor it installs (`AsyncLocalStorage`, like Flue itself; keep `nodejs_compat`). A provider you wrap with `withModelCache` yourself also needs `installModelScope()` at module scope, or it partitions per conversation only.

## Verify
```bash
pnpm --filter @agent-starter/flue test   # models.test.ts (Terra catalog), model-cache.test.ts (semantic + gateway cache), flue-e2e (budget ledger)
pnpm --filter @agent-starter/core test   # runtime.test.ts (fallback, cost ceiling, persistence), tools.test.ts (budget refusal), memory-cognition (semantic cache)
pnpm --filter @agent-starter/cloudflare test   # workers ai parsing
# generated app
pnpm typecheck && pnpm test && pnpm evals   # evals assert cost/turn caps and HALTED status
```

## Related skills
`agent-starter-memory-and-context` (compaction) · `agent-starter-security` (tenant config sync) ·
`agent-starter-planning-and-cognition` (utility-model consumers) · `agent-starter-background-jobs` (per-job
budgets, heartbeats) · `agent-starter-evals-and-ops` (efficiency report, cost dashboards) ·
`agent-starter-computer-use` (VM cost meter) · `agent-starter-definition-of-done`.

## Not yet implemented
- **Same-submission utility routing without a stamp:** when neither `agentAuth`'s `classify` nor the dispatching server stamps a route, the start-hook utility classifier only steers the next submission (Flue fixes the model before start hooks run).
- **Metering of utility calls:** critic, drift, classifier, embeddings, re-ranker and AI Search costs are not recorded in `as_budget_ledger`.
- **Prompt-cache retention hints:** no explicit retention controls beyond `prompt_cache_key`.
