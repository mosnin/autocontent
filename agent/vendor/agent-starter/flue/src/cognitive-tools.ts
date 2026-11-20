import {
  AgentGit,
  type AnyAgentTool,
  assessInjection,
  type BlobStore,
  defineAgentTool,
  EntityGraphMemory,
  type EntityGraphStore,
  GoalTree,
  type MachineDefinition,
  type ModelProvider,
  Planner,
  safeRelativeKey,
  SqlEntityGraphStore,
  type SqlStore,
  StateMachine,
  TenantIsolationError,
  TenantScopedBlobStore,
  type TenantSecurityContext,
  type VectorMemory,
  VERBATIM_OUTPUT_TAG,
  WorkspaceFS,
} from "@agent-starter/core";
import * as v from "valibot";
import { recordDbDelta } from "./observer.ts";

/**
 * Cognitive tools for Flue agents (Valibot schemas). They operate on the agent
 * instance's own SQLite, so planning state, workflow state and relational
 * memory survive restarts and hibernation.
 */
export interface PlanningToolsOptions {
  /** Cheap model for automatic re-planning when a goal FAILS (R-COG-03): the failed branch is pruned and alternatives are spawned. */
  replanModel?: () => ModelProvider | undefined;
  /** Tool names the re-planner may assign to new goals. */
  availableTools?: () => string[];
}

export function createPlanningTools(sql: () => SqlStore, scope: () => { runId: string; tenantId: string }, options: PlanningToolsOptions = {}): AnyAgentTool[] {
  const tree = () => new GoalTree(sql(), scope());
  return [
    defineAgentTool({
      name: "plan_goals",
      description: "Record a hierarchical plan: a root objective and ordered sub-goals with dependencies and risk tiers. Call once before multi-step work; call update_goal as you progress.",
      input: v.object({
        objective: v.pipe(v.string(), v.maxLength(300)),
        goals: v.pipe(
          v.array(v.object({ id: v.pipe(v.string(), v.regex(/^[a-z0-9_]{1,40}$/)), title: v.pipe(v.string(), v.maxLength(200)), dependsOn: v.optional(v.array(v.string()), []), riskTier: v.optional(v.picklist(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), "LOW") })),
          v.minLength(1),
          v.maxLength(12),
        ),
      }),
      risk: "LOW",
      sideEffect: "none",
      outputTrust: "trusted",
      execute: async ({ objective, goals }, ctx) => {
        const t = tree();
        if (!t.get("root")) t.addGoal({ id: "root", title: objective });
        for (const goal of goals) t.addGoal({ id: `root.${goal.id}`, parentId: "root", title: goal.title, riskTier: goal.riskTier, dependsOn: goal.dependsOn.map((d) => `root.${d}`) });
        t.setStatus("root", "ACTIVE");
        recordDbDelta(ctx.runId, { store: "as_goal_tree", op: "plan", goals: goals.length }, ctx.toolCallId);
        return { tree: t.render(), next: t.next()?.id ?? null };
      },
    }),
    defineAgentTool({
      name: "update_goal",
      description: "Mark a goal ACTIVE/COMPLETED/FAILED/BLOCKED after acting, optionally spawning child goals. Failed goals bubble up and trigger re-planning.",
      input: v.object({
        goalId: v.string(),
        status: v.picklist(["ACTIVE", "COMPLETED", "FAILED", "BLOCKED"]),
        result: v.optional(v.pipe(v.string(), v.maxLength(1000))),
        spawnChildren: v.optional(v.array(v.object({ id: v.pipe(v.string(), v.regex(/^[a-z0-9_]{1,40}$/)), title: v.pipe(v.string(), v.maxLength(200)) })), []),
      }),
      risk: "LOW",
      sideEffect: "none",
      outputTrust: "trusted",
      execute: async ({ goalId, status, result, spawnChildren }, ctx) => {
        const t = tree();
        if (!t.get(goalId)) throw new Error(`Unknown goal ${goalId}. Known goals: ${t.all().map((g) => g.id).join(", ")}`);
        for (const child of spawnChildren) t.addGoal({ id: `${goalId}.${child.id}`, parentId: goalId, title: child.title });
        const failed = t.setStatus(goalId, status, result);
        recordDbDelta(ctx.runId, { store: "as_goal_tree", op: "set_status", id: goalId, status, spawned: spawnChildren.length }, ctx.toolCallId);
        const model = failed.length ? options.replanModel?.() : undefined;
        if (model && goalId !== "root") {
          try {
            const replans = t.all().filter((g) => /\.r\d+_/.test(g.id)).length;
            const planner = new Planner({ intentModel: model, availableTools: options.availableTools?.() ?? ["*"] });
            const outcome = await planner.replan(t, goalId, result ?? "goal failed", replans);
            return { tree: t.render(), next: t.next()?.id ?? null, replanned: outcome.spawned, replan: outcome.message };
          } catch (error) {
            return { tree: t.render(), next: t.next()?.id ?? null, replan: `Automatic re-planning unavailable (${error instanceof Error ? error.message : String(error)}). Prune the failed branch by marking it BLOCKED and spawn alternative child goals under its parent — do not abandon the root objective.` };
          }
        }
        return {
          tree: t.render(),
          next: t.next()?.id ?? null,
          ...(failed.length ? { replan: `Goals failed: ${failed.join(", ")}. Prune the failed branch by marking it BLOCKED and spawn alternative child goals under its parent — do not abandon the root objective.` } : {}),
        };
      },
    }),
  ];
}

export function createWorkflowTools<S extends string>(sql: () => SqlStore, definition: MachineDefinition<S, Record<string, unknown>>, instanceId: () => string): AnyAgentTool[] {
  return [
    defineAgentTool({
      name: "transition_state",
      description: `Advance the deterministic workflow (${Object.keys(definition.states).join(" → ")}). Only explicitly allowed transitions succeed.`,
      input: v.object({ to: v.picklist(Object.keys(definition.states) as [S, ...S[]]), reason: v.pipe(v.string(), v.maxLength(500)) }),
      risk: "LOW",
      sideEffect: "none",
      outputTrust: "trusted",
      execute: async ({ to, reason }, ctx) => {
        const machine = new StateMachine(definition, { instanceId: instanceId(), sql: sql(), initialContext: {} });
        const from = machine.state;
        machine.transition(to, reason);
        recordDbDelta(ctx.runId, { store: "as_fsm", op: "transition", from, to }, ctx.toolCallId);
        return { state: machine.state, instructions: machine.render() };
      },
    }),
  ];
}

export interface MemoryToolsOptions {
  /**
   * The tenant-scoped (optionally user-scoped) entity graph, resolved at execution time from the
   * executing tenant, never from the model: e.g. `(tenant) => new KvEntityGraphStore({ kv, tenantId: tenant.tenantId })`.
   * A store bound to another tenant (or user) is refused. Same shape as `useAgentStarter({ entityGraph })`.
   */
  graph: (tenant: TenantSecurityContext) => EntityGraphStore | undefined;
}

/**
 * Relational long-term memory tools: remember_fact / recall_entity (R-MEM-03).
 *
 *   createMemoryTools({ graph: (tenant) => new KvEntityGraphStore({ kv, tenantId: tenant.tenantId }) })  // cross-session, tenant-scoped
 *   createMemoryTools(sql, () => tenantId)                                                              // legacy: this DO's own SQLite
 *
 * Writes are `sideEffect: "write"` (simulated in shadow/dry runs, idempotent), instruction-like text is
 * refused (memory poisoning), recalled facts are returned as untrusted data, and every write is recorded
 * as a `db.delta` on the current trace step.
 */
export function createMemoryTools(options: MemoryToolsOptions): AnyAgentTool[];
export function createMemoryTools(sql: () => SqlStore, tenantId: () => string): AnyAgentTool[];
export function createMemoryTools(first: MemoryToolsOptions | (() => SqlStore), tenantId?: () => string): AnyAgentTool[] {
  const resolve = (tenant: TenantSecurityContext): EntityGraphStore => {
    if (typeof first === "function") {
      const scoped = tenantId?.() ?? tenant.tenantId;
      if (scoped !== tenant.tenantId) throw new TenantIsolationError("Memory tools are bound to another tenant.", { tenant: tenant.tenantId });
      return new SqlEntityGraphStore(new EntityGraphMemory(first(), scoped));
    }
    const store = first.graph(tenant);
    if (!store) throw new Error("Relational memory is not configured for this workspace.");
    if (store.tenantId !== tenant.tenantId) throw new TenantIsolationError("Entity graph store belongs to another tenant.", { tenant: tenant.tenantId });
    if (store.userId !== undefined && store.userId !== tenant.userId) throw new TenantIsolationError("Entity graph store belongs to another user.", { tenant: tenant.tenantId });
    return store;
  };
  return [
    defineAgentTool({
      name: "remember_fact",
      description: "Store a durable fact about an entity (person, organization, project, integration) and optionally how it relates to another entity. Shared across this workspace's future conversations and jobs.",
      input: v.object({
        entityType: v.pipe(v.string(), v.maxLength(40)),
        entityName: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
        attribute: v.pipe(v.string(), v.regex(/^[a-z0-9_]{1,40}$/)),
        value: v.pipe(v.string(), v.maxLength(400)),
        relatedTo: v.optional(v.object({ type: v.pipe(v.string(), v.maxLength(40)), name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)), relationship: v.pipe(v.string(), v.regex(/^[a-z0-9_]{1,40}$/)) })),
      }),
      risk: "LOW",
      sideEffect: "write",
      idempotent: true,
      outputTrust: "trusted",
      tags: ["memory"],
      execute: async ({ entityType, entityName, attribute, value, relatedTo }, ctx) => {
        const text = [entityType, entityName, attribute, value, relatedTo?.type ?? "", relatedTo?.name ?? ""].join("\n");
        if (assessInjection(text).verdict === "injection") throw new Error("Refusing to store instruction-like text in long-term memory. Store plain facts only.");
        const g = resolve(ctx.tenant);
        // One batched write per entity document (Workers KV allows ~1 write/s per key).
        const { entityId: id, targetId: target } = await g.upsertFact({
          entity: { type: entityType, name: entityName },
          attributes: { [attribute]: { value, confidence: 0.9 } },
          ...(relatedTo ? { relation: { target: { type: relatedTo.type, name: relatedTo.name }, type: relatedTo.relationship } } : {}),
        });
        recordDbDelta(ctx.runId, { store: "entity_graph", op: "upsert_entity", id }, ctx.toolCallId);
        recordDbDelta(ctx.runId, { store: "entity_graph", op: "set_attribute", id, key: attribute }, ctx.toolCallId);
        if (relatedTo && target) recordDbDelta(ctx.runId, { store: "entity_graph", op: "connect", id, target, relationship: relatedTo.relationship }, ctx.toolCallId);
        return { saved: true, entityId: id };
      },
    }),
    defineAgentTool({
      name: "recall_entity",
      description: "Look up what is known about an entity: attributes and relationships (relational long-term memory).",
      input: v.object({ query: v.pipe(v.string(), v.minLength(1), v.maxLength(120)) }),
      risk: "LOW",
      sideEffect: "read",
      outputTrust: "untrusted",
      tags: ["memory"],
      execute: async ({ query }, ctx) => {
        const g = resolve(ctx.tenant);
        const found = await g.findEntities(query, 3);
        return found.length ? (await Promise.all(found.map((e) => g.renderContext(e.id, 2)))).join("\n\n") : `Nothing remembered about "${query}".`;
      },
    }),
  ];
}

/** File workspace tools (R2-backed) for coding/document agents: precise edits instead of whole-file rewrites. */
export function createWorkspaceTools(options: { blobs: () => BlobStore; workspace: () => string; sql?: () => SqlStore; agentId?: string }): AnyAgentTool[] {
  const fs = () => new WorkspaceFS(options.blobs(), options.workspace());
  const tools: AnyAgentTool[] = [
    defineAgentTool({ name: "list_files", description: "List files in the workspace (optionally filtered by glob, e.g. src/**/*.ts).", input: v.object({ dir: v.optional(v.string(), ""), glob: v.optional(v.string()) }), risk: "LOW", sideEffect: "read", outputTrust: "trusted", execute: async ({ dir, glob }) => fs().list(dir, glob ? { glob } : {}) }),
    defineAgentTool({ name: "view_lines", description: "View a line range of a file with line numbers. Prefer this over reading whole files.", input: v.object({ path: v.string(), start: v.pipe(v.number(), v.integer(), v.minValue(1)), end: v.pipe(v.number(), v.integer(), v.minValue(1)) }), risk: "LOW", sideEffect: "read", outputTrust: "untrusted", tags: [VERBATIM_OUTPUT_TAG], execute: async ({ path, start, end }) => fs().viewLines(path, start, end) }),
    defineAgentTool({ name: "search_files", description: "Regex search across workspace files (grep). Returns path, line and text.", input: v.object({ pattern: v.pipe(v.string(), v.maxLength(300)), glob: v.optional(v.string()), path: v.optional(v.string()) }), risk: "LOW", sideEffect: "read", outputTrust: "untrusted", tags: [VERBATIM_OUTPUT_TAG], execute: async ({ pattern, glob, path }) => fs().grep(pattern, { ...(glob ? { glob } : {}), ...(path ? { path } : {}), contextLines: 1 }) }),
    defineAgentTool({ name: "patch_file", description: "Replace an exact, unique block of text in a file. Fails if the block is missing or ambiguous. Returns a unified diff.", input: v.object({ path: v.string(), search: v.pipe(v.string(), v.minLength(1)), replace: v.string(), replaceAll: v.optional(v.boolean(), false) }), risk: "MEDIUM", sideEffect: "write", idempotent: true, outputTrust: "trusted", execute: async ({ path, search, replace, replaceAll }, ctx) => {
        const result = await fs().patch(path, search, replace, { replaceAll });
        recordDbDelta(ctx.runId, { store: "workspace", op: "patch", path }, ctx.toolCallId);
        return result;
      } }),
    defineAgentTool({ name: "write_file", description: "Create or overwrite a file (use patch_file for edits to existing files).", input: v.object({ path: v.string(), content: v.pipe(v.string(), v.maxLength(500_000)) }), risk: "MEDIUM", sideEffect: "write", idempotent: true, outputTrust: "trusted", execute: async ({ path, content }, ctx) => {
        const result = await fs().write(path, content);
        recordDbDelta(ctx.runId, { store: "workspace", op: "write", path, bytes: content.length }, ctx.toolCallId);
        return result;
      } }),
  ];
  if (options.sql) {
    const git = () => new AgentGit((options.sql as () => SqlStore)(), options.blobs(), options.workspace());
    tools.push(
      defineAgentTool({
        name: "commit_changes",
        description: "Commit the listed workspace files to your own branch (machine-first version control). Other agents never overwrite your work; merges detect conflicts.",
        input: v.object({ branch: v.pipe(v.string(), v.regex(/^[A-Za-z0-9._/-]{1,100}$/)), paths: v.pipe(v.array(v.string()), v.minLength(1)), message: v.pipe(v.string(), v.maxLength(300)) }),
        risk: "LOW",
        sideEffect: "write",
        idempotent: true,
        outputTrust: "trusted",
        execute: async ({ branch, paths, message }, ctx) => {
          const files: Record<string, string | null> = {};
          for (const path of paths) files[path] = (await fs().exists(path)) ? await fs().read(path) : null;
          const commitId = await git().commit(branch, files, { author: options.agentId ?? "agent", message });
          recordDbDelta(ctx.runId, { store: "as_git_commits", op: "commit", branch, commitId, files: paths.length }, ctx.toolCallId);
          return { commitId };
        },
      }),
      defineAgentTool({
        name: "merge_branch",
        description: "Three-way merge a branch into a target branch. Returns conflicts explicitly instead of overwriting.",
        input: v.object({ source: v.string(), target: v.optional(v.string(), "main") }),
        risk: "MEDIUM",
        sideEffect: "write",
        outputTrust: "trusted",
        execute: async ({ source, target }, ctx) => {
          const outcome = await git().merge(source, target, options.agentId ?? "agent");
          recordDbDelta(ctx.runId, { store: "as_git_commits", op: "merge", source, target, status: outcome.status }, ctx.toolCallId);
          if (outcome.status === "merged" || outcome.status === "fast-forward") await git().checkout(target, fs());
          return outcome;
        },
      }),
    );
  }
  return tools;
}

/**
 * Artifact delivery (zero egress): write a report/file to R2 and return its key/URL for webhooks out.
 * Keys are ALWAYS `tenants/<tenantId>/<prefix>/<name>` with the tenant taken from the executing context
 * (never from the model). A `TenantScopedBlobStore` for the same tenant is used as-is; one for another
 * tenant is refused.
 */
export function createArtifactTool(options: { blobs: () => BlobStore; prefix: () => string }): AnyAgentTool {
  return defineAgentTool({
    name: "save_artifact",
    description: "Save a generated document/report/log to durable object storage and get a reference URL to share with downstream systems.",
    input: v.object({ name: v.pipe(v.string(), v.regex(/^[A-Za-z0-9._-]{1,120}$/)), content: v.pipe(v.string(), v.maxLength(2_000_000)), contentType: v.optional(v.string(), "text/markdown") }),
    risk: "LOW",
    sideEffect: "write",
    idempotent: true,
    outputTrust: "trusted",
    execute: async ({ name, content, contentType }, ctx) => {
      const tenantId = ctx.tenant.tenantId;
      const tenantPrefix = `tenants/${tenantId}/`;
      let relative = safeRelativeKey(`${options.prefix().replace(/^\/+|\/+$/g, "") || "artifacts"}/${name}`);
      if (relative.startsWith("tenants/")) {
        if (!relative.startsWith(tenantPrefix)) throw new TenantIsolationError("Artifact prefix names another tenant.", { prefix: options.prefix() });
        relative = relative.slice(tenantPrefix.length);
      }
      const store = options.blobs();
      if (store instanceof TenantScopedBlobStore) {
        if (store.tenantId !== tenantId) throw new TenantIsolationError("Artifact blob store is scoped to another tenant.", { tenant: tenantId });
        await store.put(relative, content, { contentType });
        recordDbDelta(ctx.runId, { store: "artifacts", op: "put", key: `${store.prefix}${relative}`, bytes: content.length }, ctx.toolCallId);
        return { key: `${store.prefix}${relative}`, url: store.url(relative) ?? null, bytes: content.length };
      }
      const key = `${tenantPrefix}${relative}`;
      await store.put(key, content, { contentType });
      recordDbDelta(ctx.runId, { store: "artifacts", op: "put", key, bytes: content.length }, ctx.toolCallId);
      return { key, url: store.url?.(key) ?? null, bytes: content.length };
    },
  });
}

export interface VectorMemoryToolsOptions {
  /** Tenant-isolated semantic memory (e.g. platform `vectorMemory(tenantId)`), resolved at execution time. */
  memory: (tenantId: string) => VectorMemory;
  /** "user" (default): notes are private to the acting user. "tenant": shared by everyone in the tenant. */
  scope?: "user" | "tenant";
  /** Default note lifetime in days (the model may ask for less, never more). Omit for no expiry. */
  maxTtlDays?: number;
}

/**
 * Long-term semantic notes: remember_note / search_notes / forget_note.
 * Text is PII/secret-redacted before embedding (VectorMemory `redact`), notes can
 * expire (TTL) and are deletable by id. Gated by `TenantConfig.features.longTermMemory`
 * when mounted through useAgentStarter (tags: "memory").
 */
export function createVectorMemoryTools(options: VectorMemoryToolsOptions): AnyAgentTool[] {
  const scope = options.scope ?? "user";
  const owner = (ctx: { tenant: { userId: string } }) => (scope === "user" ? ctx.tenant.userId : "tenant");
  return [
    defineAgentTool({
      name: "remember_note",
      description: "Save a note to long-term semantic memory so it can be recalled in future conversations. Never store passwords, keys or card numbers (they are redacted).",
      input: v.object({
        title: v.pipe(v.string(), v.maxLength(120)),
        content: v.pipe(v.string(), v.minLength(1), v.maxLength(8000)),
        ttlDays: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3650))),
      }),
      risk: "LOW",
      sideEffect: "write",
      idempotent: true,
      outputTrust: "trusted",
      tags: ["memory"],
      execute: async ({ title, content, ttlDays }, ctx) => {
        const memory = options.memory(ctx.tenant.tenantId);
        const noteId = `note:${owner(ctx)}:${ctx.idempotencyKey.slice(5, 21)}`;
        const days = options.maxTtlDays !== undefined ? Math.min(ttlDays ?? options.maxTtlDays, options.maxTtlDays) : ttlDays;
        const redacted = memory.redact(`# ${title}\n${content}`).redacted;
        const chunks = await memory.memorize(noteId, `# ${title}\n${content}`, { title: title.slice(0, 120), userId: owner(ctx), kind: "note" }, days ? { ttlSeconds: days * 86_400 } : {});
        return { saved: true, noteId, chunks, redactedItems: redacted, ...(days ? { expiresInDays: days } : {}) };
      },
    }),
    defineAgentTool({
      name: "search_notes",
      description: "Semantic search over saved notes. Returns noteId, title, text and score for each hit.",
      input: v.object({ query: v.pipe(v.string(), v.minLength(2), v.maxLength(500)) }),
      risk: "LOW",
      sideEffect: "read",
      outputTrust: "untrusted",
      tags: ["memory"],
      execute: async ({ query }, ctx) => {
        const hits = await options.memory(ctx.tenant.tenantId).recall(query, { topK: 5, filter: { userId: owner(ctx) } });
        return hits.map((h) => ({ noteId: String(h.metadata.documentId ?? ""), title: String(h.metadata.title ?? ""), text: h.text, score: Number(h.score.toFixed(3)) }));
      },
    }),
    defineAgentTool({
      name: "forget_note",
      description: "Permanently delete a saved note by its noteId (from search_notes). Use when the user asks you to forget something.",
      input: v.object({ noteId: v.pipe(v.string(), v.regex(/^note:[A-Za-z0-9_.:@-]{1,200}$/)) }),
      risk: "MEDIUM",
      sideEffect: "destructive",
      idempotent: true,
      outputTrust: "trusted",
      tags: ["memory"],
      execute: async ({ noteId }, ctx) => {
        if (!noteId.startsWith(`note:${owner(ctx)}:`)) throw new TenantIsolationError("That note belongs to someone else.", { noteId });
        await options.memory(ctx.tenant.tenantId).forgetDocument(noteId);
        return { forgotten: true, noteId };
      },
    }),
  ];
}
