---
name: agent-starter-memory-and-context
description: Manage what an Agent Starter agent remembers and what reaches its context window — Flue context compaction (cheap compaction model, thresholds), the core ContextWindow sliding summary and ScratchpadCompactor, tool-output truncation, tenant-isolated VectorMemory on Cloudflare Vectorize (tenantId metadata index), Cloudflare AI Search retrieval, cross-encoder re-ranking, KnowledgeRetriever injection, relational entity-graph memory tools, persistent state (Durable Object SQLite, usePersistentState), the R2 workspace (WorkspaceFS, agent git) and artifacts, knowledge ingestion, and what to remember versus not. Use when adding memory or retrieval, wiring a knowledge source, tuning compaction or token usage, storing files/artifacts, or debugging missing, leaking or stale memories.
---

# Memory and context

## When to use
- An agent should remember something across turns, conversations or users, or should "know" a document set.
- Adding or tuning retrieval (Vectorize, AI Search, Qdrant, a SaaS search API), re-ranking, or chunking.
- Context is too long or too expensive, or compaction drops something important.
- Coding or document agents that read and write files (R2 workspace), or produce reports/artifacts.

## Mental model: memory tiers

| Tier | Scope | Where | API / wiring |
|---|---|---|---|
| Conversation transcript and hook state | one conversation (= one Durable Object) | Flue tables in the DO SQLite | Flue owns it; `usePersistentState(key, init)` for your own keys |
| Agent Starter run state | one conversation | `as_*` tables in the same DO SQLite (`CORE_MIGRATIONS`, auto-migrated by `resolveSql`) | ledger, approvals, goals, FSM, audit, scratchpad, entity graph |
| Context compaction | the model's window | Flue harness | `useModel(model, { compaction })`, set by `useAgentStarter` |
| Tool-output truncation | per tool result | `ToolExecutor.render` | `maxOutputChars` (default 12 000, head+tail) |
| Long tool outputs (Flue) | one run | `as_tool_outputs` (last 100 per run, behind a handle) | `ToolOutputStore`, `compactToolOutput`, `expand_tool_output` (`toolOutputCompaction`, threshold 4 000 chars) |
| Working-memory scratchpad, sliding summary | one run | `as_scratchpad` (last 20 frames per run) | `ScratchpadCompactor` (`AgentRuntime`, and Flue by default: every tool batch), `ContextWindow` (`AgentRuntime`); Flue: low-trigger compaction |
| Relational memory (entity graph) | **whole tenant** (or one user), every conversation and job | KV (`KvEntityGraphStore`, keys `eg/<tenant>/…`); legacy: the DO's `as_memory_*` | `useAgentStarter({ entityGraph })` (auto-injected `entity-context`) + `createMemoryTools({ graph })` → `remember_fact` / `recall_entity` |
| Semantic long-term memory | **whole tenant** (all conversations) | Vectorize index `AGENT_MEMORY_INDEX` | `VectorMemory` (`vectorMemory(tenantId)` in `platform.ts`) |
| Knowledge retrieval | tenant | Vectorize + AI Search (`AI_SEARCH_INSTANCE`) | `KnowledgeRetriever` (`retriever(tenant)` in `platform.ts`) → `useAgentStarter({ retriever })` |
| Files / workspace | tenant + workspace | R2 `WORKSPACE_BUCKET` | `WorkspaceFS`, `createWorkspaceTools`, `AgentGit` |
| Artifacts and snapshots | tenant (if you scope it) | R2 | `createArtifactTool`, `RunStore.stashSnapshot` |

Code owners:
- `packages/core/src/memory/`: `context-window.ts`, `scratchpad.ts`, `vector-memory.ts`, `reranker.ts`, `retriever.ts`, `entity-graph.ts`, `entity-graph-store.ts` (`EntityGraphStore`, `KvEntityGraphStore`, `SqlEntityGraphStore`, `entityContextFor`).
- `packages/core/src/workspace/`: `workspace-fs.ts`, `agent-git.ts`, `merge.ts`.
- `packages/core/src/tenancy/tenancy.ts`: `TenantScopedVectorStore`, `TenantScopedBlobStore`.
- `packages/cloudflare/src/adapters.ts`: `VectorizeStore`, `R2BlobStore`, `KVStore`.
- `packages/cloudflare/src/workers-ai.ts`: `WorkersAIEmbedder`, `workersAICrossEncoder`, `AiSearchSource`.
- `packages/flue/src/cognitive-tools.ts`: memory, workspace and artifact tools.
- `packages/flue/src/use-agent-starter.ts`: compaction, scratchpad, retrieval and entity-context injection.
- `packages/flue/src/observer.ts`: `recordDbDelta()` (DB deltas on the trace step; see `agent-starter-evals-and-ops`).

In a generated project, the `packages/<pkg>/src/...` paths live under `node_modules/@agent-starter/<pkg>/src/...`.

## Context compaction
- **Flue agents.** `useAgentStarter` calls `useModel(model, { thinkingLevel, compaction: compactionFor(model, modelOptions) })`. `model.compaction` is a model specifier (default `"cloudflare/@cf/openai/gpt-oss-20b"`), an object `{ model?, triggerTokens?, keepRecentTokens?, reserveTokens? }`, or `false` to disable threshold compaction (overflow recovery still compacts). Behaviour:
  - **Low trigger:** compaction starts once the context passes `triggerTokens` (default 48 000), converted to Flue's `reserveTokens` from the model's window (`model.contextWindow`; known for GPT-6.1 Terra, 272 000). Without the low trigger Flue would only compact near the window. An explicit `reserveTokens` wins.
  - Older messages are summarized **on the compaction model**, and the most recent `keepRecentTokens` (default 10 000, about the last three raw tool outputs at the 12 000-char output cap) stay verbatim.
  - The observer emits a `memory` telemetry event: "Context compacted (N → M messages)".
  - Summarization cost appears in Flue's usage for the response.
- **`AgentRuntime`.** `ContextWindow({ maxTokens: contextTokens ?? 60 000, keepRecentToolResults: 3, keepRecentMessages: 6, maxToolResultChars: 8000, summarizer: utilityModel })` does the following:
  1. Collapses tool results older than the last 3 into one-line stubs.
  2. If the history is still over budget, summarizes turns outside the protected window into a "SYSTEM HISTORY CHECKLIST".
  3. Keeps tool-call/tool-result pairs together.

  After each tool batch, `ScratchpadCompactor.compact(rawLogs, objective)` folds raw output into `{ currentFocus, factsEstablished ≤ 40, failedAttempts ≤ 20, nextPlannedAction }` and persists it in `as_scratchpad`. This is the spec's Llama-class compactor.
- **Flue scratchpad (on by default; `scratchpad: false` opts out).** Every guarded tool result (`tool → status: output`) is folded into the frame before the next model call, with `utilityModel` when set. Without a model the deterministic merge still records successes as short facts and failures as failed attempts. Every render injects `[WORKING MEMORY] focus / facts / failed (do not repeat) / next` as untrusted data. Only the last 20 frames per run are kept (`keepHistory`).
- **Flue long-output compaction (on by default; `toolOutputCompaction: false` opts out).** Spec checklist item 2: raw output must clear a cheap compaction phase before the primary model. A successful guarded output longer than `thresholdChars` (4 000) is stored whole, redacted, in `as_tool_outputs` behind a handle (`ToolOutputStore`, scoped to run + tenant). The model reads `[TOOL OUTPUT COMPACTED]` with a `utilityModel` summary in the scratchpad compactor's style (instruction-like lines dropped, untrusted outputs stay wrapped) or, without a model, head + tail, and the handle. `expand_tool_output({ handle, range? })` returns exact slices (≤ 4 000 chars, `nextStart` for paging); it is mounted once the run has a stored output. Exempt: the `verbatim-output` tag (`view_lines`, `search_files`) and `exempt` globs (default adds `branch_diff`). The scratchpad still folds the original result.
- **Both paths.** Keep tool outputs small at the source: return ids and summaries, not whole documents. Set `maxOutputChars` per tool, and use `view_lines`/`search_files` instead of whole-file reads.

## Vector memory (tenant-isolated)
`new VectorMemory({ vectors, embedder, tenantId, reranker?, maxMetadataChars? = 4000, redact? = true, ttlSeconds?, clock? })` wraps the store in a
`TenantScopedVectorStore`:
- ids `t:<tenant>:<documentId>#<chunk>`;
- namespace = tenant;
- `metadata.tenantId` stamped on every write;
- every query is force-filtered on `tenantId`, and foreign rows are dropped on the way out.

Calls:
- `memorize(documentId, text, metadata?, { ttlSeconds? })` returns the number of chunks. Text is **redacted first** (`redact: true` → `DEFAULT_MEMORY_REDACTION`: API keys, JWTs, private keys, card numbers, SSNs, IBANs; pass kinds or `false`). `VectorChunker`: 800 chars, 150 overlap, prefers paragraph/sentence breaks, carries the nearest markdown heading. Metadata stored: `documentId`, `rawText` (≤ 4000), `chunkIndex`, `chunkCount`, `savedAt`, `expiresAt` (with a TTL), `heading`, plus yours.
- `recall(query, { topK = 4, candidates = max(3·topK, 10), minScore?, filter? })`. Expired chunks are dropped. It re-ranks when a reranker is set.
- `forget(ids)`; `forgetDocument(documentId, maxChunks = 256)` deletes every `${documentId}#n` chunk; `redact(text)` previews what would be stored.
- **Note tools:** `createVectorMemoryTools({ memory: (tenantId) => vectorMemory(tenantId), scope?: "user" | "tenant", maxTtlDays? })` mounts `remember_note { title, content, ttlDays? }` (returns `noteId`), `search_notes { query }` (returns `noteId`, title, text, score; untrusted) and `forget_note { noteId }` (MEDIUM destructive; only the owner's `note:<userId>:` ids). All three are tagged `"memory"`.

Vectorize requirements:
- **Metadata index.** `wrangler vectorize create-metadata-index agent-starter-memory --property-name=tenantId --type=string`, run by `pnpm infra:init`. Without it, tenant-filtered queries return nothing. **Every other metadata field you filter on** (`userId`, `kind`, …) needs its own index.
- **Dimensions** must match the embedder: `WorkersAIEmbedder` uses bge-base, 768. Changing the embedding model means a new index.
- `VectorizeStore` caps `topK` at 50 and **truncates ids to 64 chars**. Keep `tenantId` plus `documentId` short (see Pitfalls).

## Retrieval and re-ranking
- `KnowledgeRetriever(sources, reranker?)`:
  - `retrieve(query, { topK = 5, perSourceTopK = 8, minScore? })` fans out to every `RetrievalSource { name, search(query, { topK }) }`, ignores failed sources, dedupes by the first 200 chars, and re-ranks jointly;
  - `KnowledgeRetriever.render(hits, 6000)` returns a citation-numbered block wrapped in `<untrusted_content source="retrieval">`.
- `useAgentStarter({ retriever })` runs on every **user** message in `useAgentStart`. It calls `retrieve(body, { topK: 5 })` and appends a `retrieved-context` signal before the model reads the message. Errors resolve to no context.
- `platform.ts` `retriever(tenant)` combines `memory` (VectorMemory recall) and `AiSearchSource(env.AI, AI_SEARCH_INSTANCE, { tenantId })`, then applies `CrossEncoderReranker(workersAICrossEncoder(env.AI), { topK: 5, threshold })` using `@cf/baai/bge-reranker-base`. Check the generated `platform.ts` for the threshold it passes.
- `CrossEncoderReranker(scoreFn, { topK, threshold = 0.65, scale = "auto" })` compares scores on the **probability** scale, so the spec's `pruningThreshold = 0.65` (L3995) means what it says whatever the endpoint returns. Calibration: BGE rerankers (Workers AI `bge-reranker-base`) output a raw logit ("mapped to [0, 1] by a sigmoid", model card); `toRelevanceProbabilities` applies the sigmoid when any score of the batch is outside [0, 1] (`scale: "auto"`), always (`"logit"`) or never (`"probability"`). A probability of 0.65 is a logit of about 0.62. In `"auto"`, a batch of logits that all happen to fall inside [0, 1] is read as probabilities; that only misjudges raw scores between 0.62 and 0.65. It falls back to the original order if scoring fails. `LlmReranker(model)` is an LLM-as-grader with a default threshold of 0.35.
- `AiSearchSource(ai, instance, { tenantId?, scoreThreshold = 0.3, rewriteQuery = true })` calls `env.AI.autorag(instance).search(...)`. For tenant isolation it filters on `folder = "<tenantId>/"`, so **documents must live under a `<tenantId>/` prefix** in the AI Search data source. Without `tenantId`, results are shared.
- `QdrantVectorStore` (`@agent-starter/integrations`) is a drop-in `VectorStore` when you need richer filtering. Wrap it in `VectorMemory` so tenant scoping still applies.

## Relational memory, state and files
- **Feature flag.** `TenantConfig.features.longTermMemory === false` unmounts (and denies at execution) every tool tagged `"memory"`: the entity-graph tools and the note tools.
- **Relational memory (cross-session, R-MEM-03).** The graph is an `EntityGraphStore` bound to ONE tenant (optionally one user) when it is created:
  - `new KvEntityGraphStore({ kv, tenantId, userId?, maxEntities? = 1000, maxEdgesPerEntity? = 200, ttlSeconds?, onDelta? })`: entity documents + an index under `eg/<tenantId>/t/…` (tenant) or `eg/<tenantId>/u/<encoded user>/…` (user). Every job, chat and background run of the tenant shares it; no call can reach another tenant's keys. Last-writer-wins per document (KV).
  - `new SqlEntityGraphStore(new EntityGraphMemory(sql, tenantId))`: the same interface over a DO's own SQLite (`as_memory_*`; shared only by what that DO serves).
  - Entity ids are `tenant:type:slug` (`entitySlug`: names without ASCII letters get a hash, never an empty slug).
- **Auto-injected context.** `useAgentStarter({ entityGraph: (tenant) => store })` calls `entityContextFor(store, tenant, text)` on each user message and appends an `entity-context` signal: facts and relationships of the (at most 3) known entities the message names, single-line, instruction-like lines dropped, wrapped as `<untrusted_content source="relational-memory">`. Empty when nothing known is mentioned.
- **Tools.** `createMemoryTools({ graph: (tenant) => store })` mounts `remember_fact { entityType, entityName, attribute, value, relatedTo? }` (LOW `write`, idempotent: simulated in shadow/dry runs; refuses instruction-like text) and `recall_entity { query }` (`read`, output untrusted). The tenant comes from the executing context; a store bound to another tenant or user is refused. Every write is recorded as a `db.delta` on the trace step. The legacy `createMemoryTools(sql, () => tenantId)` (what `memory: true` mounts without `entityGraph`) uses the conversation DO's SQLite.
- **Persistent state.** Don't reuse `useAgentStarter`'s keys (all prefixed `as:`): `as:tenantConfig`, `as:tenantLockdown`, `as:flaggedMessage`, `as:objective`, `as:reflections`, `as:failuresSeen`, `as:budgetEpoch`, `as:externalTools`, `as:toolErrors`, `as:routeHint`, `as:toolSelection`. `resolveSql()` (or the `sql` option in Node tests) gives you the DO's `SqlStore`. Put your own tables behind a migration (see `agent-starter-scaffold`) and prefix them, e.g. `app_`.
- **Workspace tools.** `createWorkspaceTools({ blobs, workspace, sql?, agentId? })` mounts:
  - `list_files`, `view_lines`, `search_files` (`read`; `view_lines` and `search_files` output is untrusted);
  - `patch_file` (exact unique block, returns a diff), `write_file` (`MEDIUM` write, idempotent);
  - with `sql`, also `commit_changes` and `merge_branch` (`AgentGit`: per-agent branches, three-way merge, explicit conflicts).

  `WorkspaceFS(blobs, root, { maxFileBytes = 2 MB })` rejects traversal.
- **Artifacts.** `createArtifactTool({ blobs, prefix })` mounts `save_artifact` (`LOW` write, idempotent, ≤ 2 MB) and returns `{ key, url }`. Keys are **always** `tenants/<tenantId>/<prefix>/<name>`, with the tenant from the executing context: a raw bucket gets the prefix added, a `TenantScopedBlobStore` for the same tenant is used as-is, and one for another tenant (or a prefix naming another tenant) is refused. `url` is only set when the `R2BlobStore` has a `publicBaseUrl`. Pass the key or URL to `WebhookRelay` / `notify_saas` for zero-egress delivery.

## What to remember versus not
Remember:
- Facts the user states and wants kept (preferences, constraints, decisions with ids). Tag each one with `userId`.
- Durable relationships ("Contact A works for Client B on Project C").
- Outcomes of long jobs: a short summary plus the artifact key.

Do **not** remember:
- Secrets, credentials or tokens, raw payment/identity numbers, or health data. `VectorMemory.memorize` redacts credentials, cards, SSNs and IBANs by default; don't store health data at all.
- Instructions found in untrusted content.
- Raw tool dumps or terminal output. Compact them first.
- Anything about another tenant or user.
- Content the user asked to forget. `forget_note { noteId }` / `forgetDocument(id)` delete it; give short-lived facts a TTL (`ttlDays`).

Store per-user notes with `metadata.userId` **and** a `userId` metadata index. Otherwise use a `documentId`
prefix you can filter on through the `documentId` index.

Never put retrieved text into `useInstruction`. It must arrive as a signal or tool output, wrapped as untrusted.

## Recipes
Copy-paste code lives in [references/recipes.md](references/recipes.md):
- tenant-wide relational memory (KV entity graph, auto-injected context);
- add a retrieval source;
- user-scoped notes (remember / search / forget, redaction, TTL);
- a knowledge ingestion endpoint;
- tenant-scoped workspace and artifacts;
- compaction tuning;
- `AgentRuntime` context management;
- custom persistent state.

## Checklist (spec requirements; each with its proof)
- [ ] **Context compaction runs on a cheap model**, never the frontier model. Verify: `modelOptions().compaction` (`platform.ts`) is a Workers AI model, and a long conversation emits a `memory` "Context compacted" telemetry event.
- [ ] **Sliding summary:** only the last few raw tool outputs stay verbatim; older ones become a summary. Verify: `memory-cognition.test.ts` "compacts old tool output but keeps tool-call pairs intact" (`AgentRuntime`); Flue agents compact on the cheap model from a low trigger (`compactionFor`, see `agent-starter-planning-and-cognition` for the hook defaults).
- [ ] **Working-memory scratchpad on every tool batch:** raw output is compacted into facts / failed attempts / next action before the next model call, with or without a utility model. Verify: flue `hook-capabilities.test.ts` "pre-plans a new objective, re-plans failed goals, critiques the real error and keeps a scratchpad", core `scratchpad.test.ts` "records successful results as facts and failures as failed attempts" and "keeps only the recent frame history per run".
- [ ] **Memory hygiene:** notes are redacted before embedding, expire, and can be forgotten by id. Verify: `hook-capabilities.test.ts` "redacts notes before embedding, expires them and forgets them by id", core `fix-round-c.test.ts` "redacts secrets before embedding, honours TTL and forgets whole documents".
- [ ] **`longTermMemory` flag enforced:** memory tools disappear for tenants without it. Verify: `hook-guards.test.ts` "gates memory and outbound email tools on tenant feature flags".
- [ ] **Tenant-isolated vector memory:** every write is stamped and every query filtered by `tenantId`, and foreign rows are dropped. Verify: `security.test.ts` "never returns another tenant's vectors" and `memory-cognition.test.ts` "chunks with overlap and recalls only the tenant's memories". In production, `wrangler vectorize list-metadata-index agent-starter-memory` shows `tenantId`.
- [ ] **Cross-encoder re-ranking before context injection:** low-signal chunks are pruned at the spec's 0.65 relevance (probability scale; logits go through a sigmoid). Verify: `platform.ts` passes `CrossEncoderReranker(workersAICrossEncoder(...))` to both `VectorMemory` and `KnowledgeRetriever`; core `round3.test.ts` "maps logits through a sigmoid (bge-reranker) and keeps probabilities as they are" and "prunes below the spec's 0.65 by default".
- [ ] **Raw tool output compacted before the frontier model, raw kept behind a handle.** Verify: flue `hook-round3.test.ts` "summarises a long output with the utility model and serves exact slices through expand_tool_output", core `round3.test.ts` "stores per run and tenant, serves bounded slices, and compacts with or without a model".
- [ ] **AI Search retrieval is tenant-scoped:** `AiSearchSource` gets `tenantId`, and documents are stored under `<tenantId>/`. Verify: a query from tenant A returns no tenant B files (staging check).
- [ ] **Retrieved knowledge is untrusted data with citations.** Verify: the `retrieved-context` signal body starts with `<untrusted_content source="retrieval">` and contains `[1]`.
- [ ] **Cross-session relational memory (entity graph) is shared by a tenant's conversations and jobs, never across tenants or user scopes.** Verify: core `entity-graph-store.test.ts` "shares one graph across sessions of a tenant and never across tenants or user scopes"; flue `observer-tracing.test.ts` "records the waking payload, exact prompts, tool args/outputs, sandbox code/output and DB deltas" (a fact written in one conversation is found by the tenant's next one, not by another tenant).
- [ ] **Relational context is injected for the turn subject, as untrusted data.** Verify: core `entity-graph-store.test.ts` "renders facts for entities the message mentions, wrapped as untrusted data, and drops instruction-like lines" and "refuses a store bound to another tenant or another user".
- [ ] **Memory tools refuse poisoning, foreign stores and shadow writes.** Verify: flue `observer-tracing.test.ts` "refuses instruction-like facts, foreign-tenant stores and writes in shadow runs; recall is untrusted data".
- [ ] **Chunking:** sliding window (800/150), tenant-tagged chunks, headings carried. Verify: the `VectorChunker` unit test above.
- [ ] **Workspace edits are precise diffs, not whole-file rewrites.** Verify: `memory-cognition.test.ts` "patches precisely and refuses ambiguous edits" and "merges non-overlapping edits and reports overlapping conflicts".
- [ ] **Zero-egress artifacts:** reports go to R2 and webhooks carry the key/URL. Verify: `save_artifact` → `notify_saas` in the background worker trajectory.
- [ ] **State survives hibernation and eviction:** everything durable is in DO SQLite (`as_*` / Flue tables) or R2/Vectorize, never in module globals. Verify: `runtime.test.ts` "BudgetGuard persists across instances (survives DO eviction)", plus code review for module-scope `let`/`Map` caches.
- [ ] **Files and artifacts are tenant-prefixed.** Verify: tools use `TenantScopedBlobStore` (`security.test.ts` "confines blob keys to the tenant prefix and blocks traversal") and `hook-capabilities.test.ts` "always prefixes artifact keys with tenants/<tenantId>/".

## Pitfalls
- **Vectorize id truncation:** `VectorizeStore` cuts ids at 64 chars. `t:<tenant>:` + `documentId` + `#<n>` easily exceeds that, the chunk suffix disappears, and chunks of one document overwrite each other. Keep `documentId` short, e.g. a 16-char hash.
- **Unindexed filters return nothing:** the generated `search_notes` filters on `userId`, but the infra script only indexes `tenantId` and `documentId`. Add `wrangler vectorize create-metadata-index agent-starter-memory --property-name=userId --type=string`. Vectors inserted before an index exists are not filterable on it.
- **Artifact keys changed:** `save_artifact` now writes `tenants/<tenantId>/artifacts/<date>/<name>` on a raw bucket. Downstream consumers must use the returned `key`, never rebuild it.
- **Unindexed note filters:** `search_notes` filters on `userId`; add that Vectorize metadata index (see above).
- **Retrieval cost on every user message:** it costs an embedding, a Vectorize query, an AI Search call and a reranker call. Drop `retriever` from agents that don't need it, and prefer a `search_*` tool so the model decides when to retrieve.
- **Compaction costs one utility call per long output** and the model may then spend a turn on `expand_tool_output`. Tools whose exact output the model must quote or patch need the `verbatim-output` tag (or `toolOutputCompaction.exempt`).
- **A tighter reranker threshold returns fewer chunks:** 0.65 on the probability scale is strict. If retrieval comes back empty for good queries, log the scores (`toRelevanceProbabilities`) before lowering it.
- **Compaction loses detail:** keep identifiers and commitments in durable state (goal tree, `remember_fact`, artifacts), not only in chat history.
- **Entity graph backing store:** `memory: true` without `entityGraph` still uses the conversation DO's SQLite (per conversation). Pass `entityGraph` (KV) for tenant-wide memory, and a `userId` when facts are private to one user.
- **KV graph writes are last-writer-wins:** two jobs updating the same entity at the same instant can drop one attribute. Fine for memory; never keep counters or money in it.
- **The graph caps itself:** past `maxEntities` the least recently updated entities are evicted (documents deleted). Raise it for large tenants, or set `ttlSeconds` for retention.
- **No module-scope caches of tenant data in your code:** isolates are shared across tenants. (`useAgentStarter` keeps a 60 s per-isolate cache of `TenantConfig` keyed by tenant id so tool calls see the real config; it never holds tenant content.) Never read env at module scope; use `bindings()`.
- **AI Search without `tenantId`:** an `AiSearchSource` without `tenantId` searches every tenant's documents.

## Verify
```bash
pnpm --filter @agent-starter/core test   # memory-cognition.test.ts (compaction, chunking, graph, workspace), entity-graph-store.test.ts, scratchpad.test.ts, security.test.ts (vector isolation)
pnpm --filter @agent-starter/flue test   # observer-tracing.test.ts (memory tools + cross-session graph inside Flue)
pnpm --filter @agent-starter/cloudflare test
pnpm --filter @agent-starter/integrations test   # qdrant.test.ts
# generated app
pnpm typecheck && pnpm test
npx wrangler vectorize list-metadata-index agent-starter-memory   # tenantId (+ any filter fields)
```

## Related skills
`agent-starter-security` (tenant isolation, untrusted content) · `agent-starter-models-and-cost` (compaction
and utility models, semantic cache) · `agent-starter-planning-and-cognition` (goal tree, scratchpad, critic) ·
`agent-starter-coding-agent` (workspace + agent git) · `agent-starter-background-jobs` (artifacts + webhooks
out) · `agent-starter-definition-of-done`.

## Not yet implemented
- **Exact last-3-tool-output stubbing in Flue agents:** `ContextWindow` (collapse all but the last 3 tool results into stubs) is `AgentRuntime`-only. Flue agents use the low-trigger, token-based compaction above (`keepRecentTokens` ≈ the last three outputs).
- **Knowledge ingestion pipeline:** no route, queue job or tool bulk-ingests documents (R2 → `VectorMemory.memorize` / AI Search upload under `<tenantId>/`).
- **Retrieval behind `longTermMemory`:** the flag gates memory *tools*; the `retriever` (memory + AI Search) still runs when configured.
