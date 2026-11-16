# Models and cost recipes

## 1. Change the default model, fallbacks or first line (whole app)
`wrangler.jsonc` → `vars` (read by `modelOptions()` in `src/lib/platform.ts`):
```jsonc
"AGENT_MODEL": "openai/gpt-6.1-terra",
"AGENT_FALLBACK_MODELS": "openai/gpt-5.5,cloudflare/@cf/moonshotai/kimi-k2.6",
"FIRST_LINE_MODEL": "cloudflare/@cf/meta/llama-3.1-8b-instruct"
```
Keep at least one fallback on a different provider, because the health circuit is per provider. A model that
is not in Flue's catalog must be registered first: add an entry to `EXTENDED_OPENAI_MODELS` in
`packages/flue/src/models.ts`, with pricing, context window and `thinkingLevelMap`.

## 2. Per-agent overrides
```ts
import { modelOptions, platform } from "../lib/platform.ts";

useAgentStarter({
  ...platform("support-agent", id),
  model: { ...modelOptions(), thinkingLevel: "low", routeSimpleToFirstLine: true }, // cheap, fast support replies
  budget: { maxToolCalls: 30, maxTurns: 20 },                                      // stricter-of merge with the tenant's limits
});
```
`budget` fields are merged with the tenant's (`maxTurnsPerSession`, `maxBudgetUsd`, `maxTokensPerSession`) by
taking the lower value: an agent can tighten but never lift a tenant cap (`mergeLimits` is exported).

Voice agents: `model: { ...modelOptions(), voice: "cloudflare/@cf/meta/llama-3.1-8b-instruct-fast" }` is used
when the conversation's `initialData.scopes` include `channel:voice` (thinking "off", fallbacks kept).

Tenant profiles: `model.profiles` maps specifiers to `TenantConfig.allowedModelProfiles` names when the defaults
(firstLine/voice → `first-line`, everything else → `frontier`) don't fit, e.g.
`profiles: { "openai/gpt-5.5": "frontier-backup" }`.

## 3. AI Gateway for utility and core-plane calls
```ts
// src/lib/platform.ts
import { aiGatewayBaseUrl, aiGatewayHeaders, WorkersAIProvider } from "@agent-starter/cloudflare";
import { OpenAIResponsesProvider } from "@agent-starter/core";

export const utilityModel = () => new WorkersAIProvider(bindings().AI, { gateway: { id: "agent-starter", cacheTtl: 3600 } });

export function frontierProvider(tenantId: string) {
  const b = bindings();
  return new OpenAIResponsesProvider({
    apiKey: b.OPENAI_API_KEY,
    baseUrl: aiGatewayBaseUrl(b.CF_ACCOUNT_ID ?? "", "agent-starter", "openai"),
    headers: aiGatewayHeaders({ metadata: { tenant: tenantId }, skipCache: true }), // tool-using agent calls must not be cached
  });
}
```
- Create the gateway (`agent-starter`) in the Cloudflare dashboard.
- For an authenticated gateway, add `gatewayToken` from a secret (`wrangler secret put AI_GATEWAY_TOKEN`, then type it in `src/env.ts`).

**Flue agent turns through the gateway** (`src/app.ts`, module top level, once):
```ts
import { aiGatewayOpenAIBaseUrl, aiGatewayOpenAIHeaders, registerExtendedModels } from "@agent-starter/flue";

registerExtendedModels({
  baseUrl: aiGatewayOpenAIBaseUrl({ accountId: "<account id>", gatewayId: "agent-starter" }),
  headers: aiGatewayOpenAIHeaders({ token: "<from a secret>", metadata: { app: "agents" } }), // no PII in metadata
});
```
The generated `platform.ts` exposes `modelGateway()` (reads `CF_ACCOUNT_ID`, `AI_GATEWAY_ID`, `AI_GATEWAY_TOKEN`)
for exactly this call. Don't set `cacheTtlSeconds` for tool-using agent turns.

## 4. `ModelRouter` with first-line routing and tenant-allowed profiles (`AgentRuntime` / utility code)
```ts
import { WorkersAIProvider } from "@agent-starter/cloudflare";
import { BudgetGuard, ModelRouter, OpenAIResponsesProvider } from "@agent-starter/core";

const b = bindings();
const budget = new BudgetGuard({ runId, tenantId: tenant.tenantId, limits: { maxTurns: tenantConfig.maxTurnsPerSession, maxCostUsd: tenantConfig.maxBudgetUsd }, sql });
const router = new ModelRouter({
  profiles: {
    frontier: { provider: new OpenAIResponsesProvider({ apiKey: b.OPENAI_API_KEY }), label: "frontier", reasoningEffort: "medium" },
    "frontier-backup": { provider: new OpenAIResponsesProvider({ apiKey: b.OPENAI_API_KEY, model: "gpt-5.5", id: "openai-backup" }) },
    "first-line": { provider: new WorkersAIProvider(b.AI), label: "first-line" },
  },
  defaultProfile: "frontier",
  frontierProfile: "frontier",
  firstLineProfile: "first-line",
  fallbacks: { frontier: ["frontier-backup", "first-line"] },
  allowedProfiles: tenantConfig.allowedModelProfiles, // free tier: ["first-line"]
  budget, sql, runId, tenantId: tenant.tenantId,
});
const decision = await router.route(userMessage);    // { profile: "first-line" | "frontier", reason } → as_router_log
const reply = await router.generate({ profile: decision.profile, messages: [{ role: "user", content: userMessage }] });
```
`TenantConfig.allowedModelProfiles` values must match the profile names you define here.

## 5. Contract pricing
```ts
import { CostModel } from "@agent-starter/core";
const costModel = new CostModel({ "gpt-6.1-terra": { input: 0.9, output: 4.5, cachedInput: 0.045 } });
// new BudgetGuard({ ..., costModel }) or new AgentRuntime({ ..., costModel })
```
In Flue agents the ledger prefers `response.usage.cost.total`, which Flue computes from the model catalog.
`useAgentStarter` falls back to `new CostModel()` defaults only when that cost is 0. Contract pricing for Flue
traffic therefore means editing the catalog entry's `cost` (`EXTENDED_OPENAI_MODELS`).

## 6. Read budget and usage from a reply (UI, tests, evals)
```ts
const reply = await agent.read(await agent.dispatch({ message: "…", initialData: { tenantId: "t1", userId: "u1" } }));
const meta = (reply.metadata ?? {}) as { model?: string; usage?: { tokens: number; costUsd: number }; budget?: { turns: number; costUsd: number; maxCostUsd: number; maxTurns: number; exhausted: boolean } };
```
`src/lib/evals.ts` maps the result to `HALTED` when `exhausted` and to `TERMINATED` when `securityLocked`.

## 7. Ledger queries (inside a tool or a debug route running in the agent's DO)
```ts
import { resolveSql } from "@agent-starter/flue";
const rows = resolveSql().exec<{ kind: string; n: number; cost: number }>(
  `SELECT kind, COUNT(*) AS n, SUM(cost_usd) AS cost FROM as_budget_ledger WHERE run_id = ? GROUP BY kind`, ctx.runId);
```

## 8. Recovery-wrapped flaky step
```ts
import { RecoveryManager } from "@agent-starter/core";
import { resolveSql } from "@agent-starter/flue";

execute: async (args, ctx) => {
  const recovery = new RecoveryManager(resolveSql(), {
    scope: `render:${ctx.runId}`,
    maxRetries: 3,
    strategies: { VM_UNREACHABLE: { heal: async () => { /* power-cycle / re-fork the VM */ }, backoffMs: (n) => 2000 * n } },
  });
  return recovery.executeWithRecovery("render_report", () => renderReport(args, ctx.signal)); // throws RECOVERY_EXHAUSTED "[CRITICAL_HALT] …" when done
},
```
Backoff sleeps count against the tool's `timeoutMs`. Size it accordingly, or move long recovery into a
background job.

## 9. Per-job budgets for event-driven agents
The ledger is keyed by the budget scope (the conversation id by default). Per-contact agents that handle one
event per submission should reset per submission:
```ts
useAgentStarter({ ...platform("background-worker", id), tools, budgetScope: "submission" });
// or a job id carried on the signal: budgetScope: ({ delivery }) => (delivery.kind === "signal" ? delivery.attributes?.jobId ?? "default" : "chat")
```
Firewall quotas share the same scope. Alternatively give each job its own session key
(`agentInstanceId("background-worker", tenantId, \`job-${eventId}\`)`).

## 10. Budget breach: snapshot to R2 and alert ops
Generated apps already pass this from `platform()` (`src/lib/platform.ts`), and the breach is also published as a
`BUDGET_LIMIT_BREACHED` telemetry alert to the WebhookRelay/Pusher sinks. The shape, for custom wiring:
```ts
useAgentStarter({
  ...platform("background-worker", id),
  budgetBreach: { snapshots: () => workspaceBlobs(), notifier: () => notifier(), recipient: () => bindings().OPS_ALERT_EMAIL },
});
```
Fires once per budget scope: the snapshot lands at `tenants/<tenantId>/snapshots/<runId>/<ts>.json`
(ledger, goals, reflections, breach, workflow state, recent tool errors) and the alert names the key.
`OPS_ALERT_EMAIL` is declared in the generated `wrangler.jsonc` vars and `src/env.ts`; set it to your ops inbox.

## 11. Semantic prompt cache + AI Gateway caching (Flue agents)
```ts
// src/lib/platform.ts — modelGateway() feeds registerExtendedModels() at the top of src/app.ts
import { KVStore, WorkersAIEmbedder } from "@agent-starter/cloudflare";

export function modelGateway(): ExtendedModelsOptions | undefined {
  const b = bindings();
  const semanticCache = {
    kv: () => new KVStore(bindings().AGENT_CACHE),                                   // resolved per call
    embedder: () => new WorkersAIEmbedder(bindings().AI, "@cf/baai/bge-small-en-v1.5"), // omit for exact hits only
    threshold: 0.96,
    ttlSeconds: 3600,
  };
  if (!b.CF_ACCOUNT_ID || !b.AI_GATEWAY_ID) return { semanticCache };
  const headers = aiGatewayOpenAIHeaders({ ...(b.AI_GATEWAY_TOKEN ? { token: b.AI_GATEWAY_TOKEN } : {}), cacheTtlSeconds: 3600 }); // cf-aig-cache-ttl
  return { baseUrl: aiGatewayOpenAIBaseUrl({ accountId: b.CF_ACCOUNT_ID, gatewayId: b.AI_GATEWAY_ID }), headers, semanticCache };
}
```
- Both caches are partitioned by tenant (`cacheScope: "user"` for per-user). Hits are free and carry
  `responseId: "semcache_…"`; misses store only final text answers.
- Watch the hit rate with `semanticCache.onEvent` (hit / miss / store / bypass) or the tracer attribute
  `agent.semantic_cache_hit`.
- To cache another pi-ai provider: `setProvider(createProvider({ ..., api: withModelCache(api, { semantic, gatewayCache }) }))`
  plus `installModelScope()` at module scope.
