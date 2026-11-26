import { CircuitBreaker, CORE_MIGRATIONS, MigrationRunner, registerJsonSchemaConverter, type SqlStore, type SqlValue, type StandardSchemaV1, TOOL_MIGRATIONS } from "@agent-starter/core";
import { toJsonSchema as valibotToJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";

// Flue tools are authored with Valibot; teach the core engine to turn them into JSON Schema.
registerJsonSchemaConverter((schema: StandardSchemaV1) =>
  schema["~standard"].vendor === "valibot" ? (valibotToJsonSchema(schema as unknown as v.GenericSchema, { errorMode: "ignore" }) as Record<string, unknown>) : undefined,
);

/** Durable Object SQLite reached from inside a Flue agent (tools and event hooks run inside the agent's DO). */
interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] };
}

class FlueSqlStore implements SqlStore {
  constructor(private readonly sql: SqlLike) {}
  exec<T = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): T[] {
    const params = bindings.map((b) => (typeof b === "bigint" ? Number(b) : b instanceof Uint8Array ? b.slice().buffer : b));
    return this.sql.exec(query, ...params).toArray() as T[];
  }
  transaction<T>(fn: () => T): T {
    // DO SQLite commits every synchronous write block atomically (implicit transaction per turn).
    return fn();
  }
}

const migrated = new WeakSet<object>();

interface CloudflareContextLike {
  env: Record<string, unknown>;
  storage: { sql: unknown };
}

let cloudflareContext: (() => CloudflareContextLike) | null = null;

/**
 * Called by `@agent-starter/flue/cloudflare` (import it once in app.ts) so the
 * portable core of this package never imports `cloudflare:*` modules itself.
 */
export function registerCloudflareContext(resolver: () => CloudflareContextLike): void {
  cloudflareContext = resolver;
}

/**
 * The agent instance's own SQLite database (same DO as the Flue conversation).
 * Core tables are `as_`-prefixed so they never collide with Flue's tables.
 * Pass `override` on the Node target (e.g. NodeSqlStore) where no DO exists.
 */
export function resolveSql(override?: () => SqlStore): SqlStore {
  if (override) {
    const store = override();
    ensureMigrated(store);
    return store;
  }
  if (!cloudflareContext) {
    throw new Error('Agent Starter: no SQL store available. On Cloudflare add `import "@agent-starter/flue/cloudflare";` to src/app.ts; on Node pass `sql: () => store` to useAgentStarter.');
  }
  const raw = cloudflareContext().storage.sql as unknown as SqlLike;
  const store = new FlueSqlStore(raw);
  if (!migrated.has(raw)) {
    const runner = new MigrationRunner(store);
    runner.migrateUp(CORE_MIGRATIONS);
    runner.migrateUp(TOOL_MIGRATIONS);
    migrated.add(raw);
  }
  return store;
}

function ensureMigrated(store: SqlStore): void {
  if (migrated.has(store)) return;
  const runner = new MigrationRunner(store);
  runner.migrateUp(CORE_MIGRATIONS);
  runner.migrateUp(TOOL_MIGRATIONS);
  migrated.add(store);
}

/** Worker env bindings from inside an agent, or undefined off-Cloudflare. */
export function resolveEnv(): Record<string, unknown> {
  try {
    return cloudflareContext?.().env ?? {};
  } catch {
    return {};
  }
}

/**
 * Per-isolate provider health. The observer marks failures from `turn` events;
 * renders read it synchronously to pick a fallback model for the next
 * submission when the primary provider's circuit is open.
 */
export const modelHealth = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });

export function providerOf(modelSpecifier: string): string {
  return modelSpecifier.split("/")[0] ?? modelSpecifier;
}

/** Trusted identity every Agent Starter Flue agent is created with (injected server-side by the auth middleware). */
export const AgentStarterInitialData = v.object({
  tenantId: v.pipe(v.string(), v.regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)),
  userId: v.pipe(v.string(), v.minLength(1)),
  environment: v.optional(v.picklist(["production", "staging", "development", "test"]), "production"),
  roles: v.optional(v.array(v.string()), []),
  scopes: v.optional(v.array(v.string()), []),
  /** Root objective for background jobs (drift sentinel anchors on it). */
  objective: v.optional(v.string()),
  /** "shadow"/"dry-run" simulate mutating tools (eval harness, shadow deploys). Only trusted server routes set this. */
  mode: v.optional(v.picklist(["live", "shadow", "dry-run"]), "live"),
  /** Free-form app context (page, entity) for in-app copilots. */
  context: v.optional(v.record(v.string(), v.unknown())),
  /**
   * Optional server-loaded TenantConfig seed (set only by trusted server code, e.g. agentAuth extraInitialData).
   * Used for render-time decisions (model profile, tool visibility) before the first config load; execution-time
   * enforcement always reloads through `loadTenantConfig`.
   */
  tenantConfig: v.optional(v.record(v.string(), v.unknown())),
  /**
   * Persistent agents only (set by the control plane's dispatch, never by agentAuth): which persistent agent this
   * conversation is and who owns it. Build the identity with `agentIdentity(tenantId, agentId, ownerUserId)`.
   */
  persistent: v.optional(v.object({ agentId: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i)), ownerUserId: v.pipe(v.string(), v.minLength(1), v.maxLength(256)) })),
});
export type AgentStarterInitialData = v.InferOutput<typeof AgentStarterInitialData>;
