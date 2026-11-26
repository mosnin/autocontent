import { type MigrationSet, MigrationRunner } from "../storage/migrations.ts";
import type { SqlStore } from "../storage/ports.ts";
import type { TenantConfig } from "../tenancy/tenancy.ts";

export interface ArgumentRule {
  /** Tool name glob this rule applies to. */
  tool: string;
  /** Dot path into the arguments, e.g. "to" or "recipients.*". */
  path: string;
  deny?: RegExp;
  allow?: RegExp;
  message: string;
}

export interface ToolFirewallPolicy {
  /** Glob patterns (e.g. "GMAIL_*", "mcp__linear__*"). Empty/undefined = allow all not denied. */
  allow?: string[];
  deny?: string[];
  /** Max calls per tool name within one run (protects against loops hammering one API). */
  maxCallsPerTool?: number;
  maxTotalCalls?: number;
  argumentRules?: ArgumentRule[];
}

export interface FirewallDecision {
  allowed: boolean;
  reason?: string;
}

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAny(name: string, patterns: string[] | undefined): boolean {
  return (patterns ?? []).some((p) => globToRegExp(p).test(name));
}

function valuesAtPath(value: unknown, path: string): unknown[] {
  const parts = path.split(".");
  let current: unknown[] = [value];
  for (const part of parts) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item === null || typeof item !== "object") continue;
      if (part === "*") next.push(...(Array.isArray(item) ? item : Object.values(item as Record<string, unknown>)));
      else next.push((item as Record<string, unknown>)[part]);
    }
    current = next.filter((v) => v !== undefined);
  }
  return current.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

/**
 * Where per-run call quotas are counted. The default is in-memory (one
 * firewall instance = one quota window). Hosts that rebuild the firewall per
 * call (Flue renders, restarts, hibernation) must pass a durable store such as
 * `SqlFirewallCounters`, otherwise `maxCallsPerTool` never holds.
 */
export interface FirewallCounterStore {
  count(toolName: string): number;
  total(): number;
  increment(toolName: string): void;
}

export class MemoryFirewallCounters implements FirewallCounterStore {
  private readonly counts = new Map<string, number>();
  private sum = 0;
  count(toolName: string): number {
    return this.counts.get(toolName) ?? 0;
  }
  total(): number {
    return this.sum;
  }
  increment(toolName: string): void {
    this.counts.set(toolName, this.count(toolName) + 1);
    this.sum++;
  }
}

/** Namespaced schema for tool-layer state (independent of CORE_MIGRATIONS). */
export const TOOL_MIGRATIONS: MigrationSet = {
  namespace: "agent-starter-tools",
  migrations: [
    {
      version: 1,
      name: "firewall_counters",
      up: [
        `CREATE TABLE IF NOT EXISTS as_firewall_counters (
          scope TEXT NOT NULL,
          tool TEXT NOT NULL,
          calls INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope, tool)
        )`,
      ],
      down: [`DROP TABLE IF EXISTS as_firewall_counters`],
    },
    {
      version: 2,
      name: "tool_outputs",
      up: [
        // Raw (redacted) long tool outputs behind a handle; the model sees a compacted form (contract 4).
        `CREATE TABLE IF NOT EXISTS as_tool_outputs (
          handle TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          tool_call_id TEXT,
          content TEXT NOT NULL,
          chars INTEGER NOT NULL,
          trusted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS as_tool_outputs_run ON as_tool_outputs (run_id, created_at)`,
      ],
      down: [`DROP TABLE IF EXISTS as_tool_outputs`],
    },
  ],
};

const toolMigrated = new WeakSet<object>();

/** Apply TOOL_MIGRATIONS once per store (idempotent; versioned in as_schema_version). */
export function ensureToolMigrations(sql: SqlStore): void {
  if (toolMigrated.has(sql)) return;
  new MigrationRunner(sql).migrateUp(TOOL_MIGRATIONS);
  toolMigrated.add(sql);
}

/**
 * Durable quota counters in SQLite, keyed by a scope (usually the run id).
 * Counts survive new firewall instances, renders, restarts and hibernation.
 */
export class SqlFirewallCounters implements FirewallCounterStore {
  constructor(
    private readonly sql: SqlStore,
    private readonly scope: string,
    private readonly clock: () => number = Date.now,
  ) {
    ensureToolMigrations(sql);
  }

  count(toolName: string): number {
    const row = this.sql.exec<{ calls: number }>(`SELECT calls FROM as_firewall_counters WHERE scope = ? AND tool = ?`, this.scope, toolName)[0];
    return Number(row?.calls ?? 0);
  }

  total(): number {
    const row = this.sql.exec<{ n: number | null }>(`SELECT SUM(calls) AS n FROM as_firewall_counters WHERE scope = ?`, this.scope)[0];
    return Number(row?.n ?? 0);
  }

  increment(toolName: string): void {
    this.sql.exec(
      `INSERT INTO as_firewall_counters (scope, tool, calls, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(scope, tool) DO UPDATE SET calls = calls + 1, updated_at = excluded.updated_at`,
      this.scope,
      toolName,
      this.clock(),
    );
  }
}

export interface ToolFirewallOptions {
  /** Quota counter store. Default: in-memory (per firewall instance). */
  counters?: FirewallCounterStore;
}

/**
 * Agent firewall: allow/deny lists (global + per-tenant), per-run call quotas and
 * argument rules (e.g. "emails may only go to @customer.com"). Applies equally to
 * first-party tools, Composio actions and MCP tools.
 *
 * Quotas count executed calls (`record`) plus calls currently in flight
 * (`reserve`), so a parallel tool batch cannot overshoot `maxCallsPerTool`.
 */
export class ToolFirewall {
  private readonly counters: FirewallCounterStore;
  private readonly inflight = new Map<string, number>();
  private inflightTotal = 0;

  constructor(
    private readonly policy: ToolFirewallPolicy = {},
    options: ToolFirewallOptions = {},
  ) {
    this.counters = options.counters ?? new MemoryFirewallCounters();
  }

  evaluate(toolName: string, args: unknown, tenantConfig?: TenantConfig): FirewallDecision {
    if (matchesAny(toolName, this.policy.deny) || matchesAny(toolName, tenantConfig?.deniedTools)) {
      return { allowed: false, reason: `Tool "${toolName}" is denied by firewall policy.` };
    }
    if (this.policy.allow && this.policy.allow.length > 0 && !matchesAny(toolName, this.policy.allow)) {
      return { allowed: false, reason: `Tool "${toolName}" is not on the firewall allowlist.` };
    }
    if (tenantConfig?.allowedTools && !matchesAny(toolName, tenantConfig.allowedTools)) {
      return { allowed: false, reason: `Tool "${toolName}" is not enabled for this tenant.` };
    }
    if (this.policy.maxCallsPerTool !== undefined) {
      const used = this.counters.count(toolName) + (this.inflight.get(toolName) ?? 0);
      if (used >= this.policy.maxCallsPerTool) return { allowed: false, reason: `Tool "${toolName}" exceeded ${this.policy.maxCallsPerTool} calls this run.` };
    }
    if (this.policy.maxTotalCalls !== undefined && this.counters.total() + this.inflightTotal >= this.policy.maxTotalCalls) {
      return { allowed: false, reason: `Run exceeded ${this.policy.maxTotalCalls} total tool calls.` };
    }
    for (const rule of this.policy.argumentRules ?? []) {
      if (!globToRegExp(rule.tool).test(toolName)) continue;
      for (const value of valuesAtPath(args, rule.path)) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (rule.deny?.test(text) || (rule.allow && !rule.allow.test(text))) return { allowed: false, reason: rule.message };
      }
    }
    return { allowed: true };
  }

  /** Hold a quota slot for a call that passed `evaluate` and has not finished yet. Returns the release function (idempotent). */
  reserve(toolName: string): () => void {
    this.inflight.set(toolName, (this.inflight.get(toolName) ?? 0) + 1);
    this.inflightTotal++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.inflight.get(toolName) ?? 1) - 1;
      if (left <= 0) this.inflight.delete(toolName);
      else this.inflight.set(toolName, left);
      this.inflightTotal = Math.max(0, this.inflightTotal - 1);
    };
  }

  /** Count one executed call against the quotas. */
  record(toolName: string): void {
    this.counters.increment(toolName);
  }

  /** Calls counted so far for a tool (executed only). */
  used(toolName: string): number {
    return this.counters.count(toolName);
  }

  /** Filter a tool list down to what the firewall would ever permit (used before exposing tools to the model). */
  visible<T extends { name: string }>(tools: T[], tenantConfig?: TenantConfig): T[] {
    return tools.filter((tool) => {
      if (matchesAny(tool.name, this.policy.deny) || matchesAny(tool.name, tenantConfig?.deniedTools)) return false;
      if (this.policy.allow?.length && !matchesAny(tool.name, this.policy.allow)) return false;
      if (tenantConfig?.allowedTools && !matchesAny(tool.name, tenantConfig.allowedTools)) return false;
      return true;
    });
  }
}
