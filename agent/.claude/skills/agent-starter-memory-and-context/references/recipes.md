# Memory and context recipes

All snippets follow generated-project conventions. Platform wiring lives in `src/lib/platform.ts`, agents in
`src/agents/*.ts`, and env is read at use time via `bindings()`.

## 0. Tenant-wide relational memory (entity graph on KV, auto-injected)
```ts
// src/lib/platform.ts
import { KvEntityGraphStore } from "@agent-starter/core";
import { KVStore } from "@agent-starter/cloudflare";

/** One graph per tenant, shared by every conversation and job (pass userId for a per-user graph). */
export const entityGraph = (tenant: TenantSecurityContext) => new KvEntityGraphStore({ kv: new KVStore(bindings().AGENT_CACHE), tenantId: tenant.tenantId });

// in platform(agentName, id): useAgentStarter injects an `entity-context` signal for entities the message names
//   entityGraph,

// src/agents/assistant.ts — the tools write to and read from the same graph
import { createMemoryTools } from "@agent-starter/flue";
useAgentStarter({ ...platform("assistant", id), tools: [...createMemoryTools({ graph: entityGraph })] });
```
- `remember_fact` is a LOW `write` (simulated in shadow runs) and refuses instruction-like text; `recall_entity`
  output reaches the model as untrusted data.
- Injected context is `entityContextFor(store, tenant, text)`: at most 3 mentioned entities, 2000 chars, wrapped
  in `<untrusted_content source="relational-memory">`. Call it yourself for non-Flue code paths.
- Background jobs can seed the graph from events with `new EntityGraphMemory(...).ingest(text, utilityModel)` on the
  SQL store, or by calling `saveEntity` / `saveAttribute` / `connect` on the KV store.

## 1. Add a retrieval source (e.g. your SaaS knowledge-base search)
```ts
// src/lib/platform.ts — extend retriever(tenant)
import type { MemoryHit, RetrievalSource } from "@agent-starter/core";

function saasKnowledgeBase(tenant: TenantSecurityContext): RetrievalSource {
  return {
    name: "saas-kb",
    search: async (query, { topK }): Promise<MemoryHit[]> => {
      const b = bindings();
      if (!b.PRIMARY_SAAS_API_URL || !b.SAAS_SERVICE_TOKEN) return [];
      const res = await fetch(`${b.PRIMARY_SAAS_API_URL}/api/kb/search?q=${encodeURIComponent(query)}&limit=${topK}`, {
        headers: { authorization: `Bearer ${b.SAAS_SERVICE_TOKEN}`, "x-tenant-id": tenant.tenantId },
      });
      if (!res.ok) return []; // a failing source must not break retrieval
      const rows = (await res.json()) as Array<{ id: string; title: string; body: string; score: number }>;
      return rows.map((r) => ({ id: r.id, text: r.body, score: r.score, source: "saas-kb", metadata: { title: r.title, tenantId: tenant.tenantId } }));
    },
  };
}
// in retriever(tenant):  sources.push(saasKnowledgeBase(tenant));
```
The `KnowledgeRetriever` re-ranks all sources jointly. Scores from different sources are not comparable until
the cross-encoder rescores them, so keep a reranker configured whenever you have more than one source.

## 2. User-scoped notes: remember, search, forget (redacted, with TTL)
```bash
npx wrangler vectorize create-metadata-index agent-starter-memory --property-name=userId --type=string
```
```ts
// src/agents/assistant.ts
import { createVectorMemoryTools, useAgentStarter } from "@agent-starter/flue";
import { platform, vectorMemory } from "../lib/platform.ts";

const ctx = useAgentStarter({
  ...platform("assistant", id),
  // remember_note / search_notes / forget_note; text is PII/secret-redacted before embedding,
  // notes expire after at most 365 days, forget_note only deletes the acting user's notes.
  tools: [...createVectorMemoryTools({ memory: vectorMemory, maxTtlDays: 365 })],
});
```
Note ids are `note:<userId>:<16 hex>` (short enough for Vectorize's 64-char id limit after the `t:<tenant>:`
prefix only when user ids are short; prefer `scope: "tenant"` or short user ids otherwise). The tools are tagged
`"memory"`, so tenants with `features.longTermMemory: false` never see them. To build your own memory tool,
call `vectorMemory(tenantId).memorize(id, text, metadata, { ttlSeconds })` (redaction is on by default) and
`forgetDocument(id)`.

## 3. Knowledge ingestion endpoint (admin → tenant VectorMemory)
```ts
// src/lib/knowledge.ts  — mount in src/app.ts with app.route("/", knowledgeRoutes)
import { type SessionClaims, verifySessionToken } from "@agent-starter/core";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env.ts";
import { vectorMemory } from "./platform.ts";

const Doc = z.object({ documentId: z.string().regex(/^[A-Za-z0-9_.:-]{1,32}$/), title: z.string().max(200), text: z.string().min(1).max(200_000) });

export const knowledgeRoutes = new Hono<{ Bindings: Env }>().post("/api/knowledge", async (c) => {
  let claims: SessionClaims;
  try {
    claims = await verifySessionToken([c.env.SESSION_SIGNING_SECRET, c.env.SESSION_SIGNING_SECRET_PREVIOUS ?? ""], c.req.header("authorization") ?? null);
  } catch {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  if (!claims.roles.includes("admin")) return c.json({ error: "FORBIDDEN" }, 403);
  const body = Doc.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "INVALID_REQUEST", issues: body.error.issues }, 400);
  const chunks = await vectorMemory(claims.tid).memorize(body.data.documentId, body.data.text, { title: body.data.title, kind: "kb" });
  return c.json({ documentId: body.data.documentId, chunks }, 201);
});
```
- The tenant comes from the session, never from the body.
- For very large corpora, enqueue documents (`agent-starter-background-jobs`) and memorize in the consumer.
- For managed ingestion, upload to the AI Search data-source bucket under `<tenantId>/…` and let AI Search chunk and index.

## 4. Tenant-scoped artifacts and workspace
```ts
// src/agents/background-worker.ts
import { parseAgentInstanceId, TenantScopedBlobStore } from "@agent-starter/core";
import { createArtifactTool } from "@agent-starter/flue";
import { workspaceBlobs } from "../lib/platform.ts";

const tenantOf = (id: string) => parseAgentInstanceId(id)?.tenantId ?? "public";
// inside the agent function (id = AgentProps.id):
const artifacts = createArtifactTool({ blobs: () => new TenantScopedBlobStore(workspaceBlobs(), tenantOf(id)), prefix: () => `artifacts/${new Date().toISOString().slice(0, 10)}` });
// A raw bucket works too: createArtifactTool always writes tenants/<tenantId>/<prefix>/<name> (tenant from ctx).
```
The workspace tools follow the same pattern: `src/agents/coder.ts` builds
`createWorkspaceTools({ blobs: tenantBlobs, workspace, sql: () => resolveSql(), agentId: "coder" })`.

## 5. Tune compaction per agent
```ts
useAgentStarter({
  ...platform("analyst", id),
  // model specifier, false (disable threshold compaction) or thresholds:
  model: { ...modelOptions(), compaction: { model: "cloudflare/@cf/meta/llama-3.1-8b-instruct", triggerTokens: 32_000, keepRecentTokens: 6000 } },
  // scratchpad is on by default (every tool batch); scratchpad: false opts out
});
```
`modelOptions` is exported from `src/lib/platform.ts`. Defaults: `triggerTokens` 48 000 (turned into Flue's
`reserveTokens` from the model's context window; pass `model.contextWindow` for models outside the extended
catalog), `keepRecentTokens` 10 000. An explicit `reserveTokens` overrides the trigger.

## 6. `AgentRuntime` (Node, evals, custom DOs): full context management
```ts
import { AgentRuntime, KnowledgeRetriever, singleProviderRouter } from "@agent-starter/core";

const runtime = new AgentRuntime({
  agent: "batch-analyst", runId, tenant, tenantConfig, sql, tools,
  instructions: "You analyse uploaded reports.",
  model: singleProviderRouter(frontierProvider),
  utilityModel: cheapProvider,                 // summarizer for ContextWindow + ScratchpadCompactor
  contextTokens: 40_000,                       // ContextWindow budget (default 60 000)
  retriever: new KnowledgeRetriever(sources, reranker),
});
const result = await runtime.run({ message: "Summarise Q3 churn drivers" });
```

## 7. Your own persistent state in a Flue agent
```ts
import { usePersistentState } from "@flue/runtime";

const [lastSyncAt, setLastSyncAt] = usePersistentState("app:lastSyncAt", 0); // never use the "as:" prefix
```
For anything relational, add an `app_*` table through a migration and query it with `resolveSql()` inside tools.
