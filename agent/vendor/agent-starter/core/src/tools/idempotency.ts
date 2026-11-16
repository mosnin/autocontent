import type { SqlStore } from "../storage/ports.ts";
import { sha256Hex, stableStringify } from "../util/crypto.ts";

/**
 * STARTED: in flight (or interrupted before an outcome was recorded).
 * COMPLETED: result recorded; replays return it.
 * FAILED: a definite rejection (e.g. a 4xx); a replay may execute again.
 * UNKNOWN: the attempt ended without a definite outcome (timeout, network or
 * 5xx error) — the side effect may have happened, so a non-idempotent replay
 * returns UNKNOWN_OUTCOME instead of executing again (R18).
 */
export type IdempotencyStatus = "STARTED" | "COMPLETED" | "FAILED" | "UNKNOWN";

export interface IdempotencyRecord {
  key: string;
  status: IdempotencyStatus;
  result?: unknown;
  error?: string;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  start(key: string, meta: { runId: string; tool: string }): Promise<"started" | "exists">;
  complete(key: string, result: unknown): Promise<void>;
  fail(key: string, error: string): Promise<void>;
  /** Record an attempt whose outcome is unknown (stores without it fall back to `fail`). */
  unknown?(key: string, error: string): Promise<void>;
}

/**
 * Deterministic idempotency key for a side-effecting step: the same run + step
 * name (+ arguments) always yields the same key, so a fiber that recovers and
 * replays a step is recognised by downstream systems (no double billing / twin
 * notifications).
 */
export async function deriveIdempotencyKey(parts: { runId: string; step: string; tool?: string; args?: unknown }): Promise<string> {
  const digest = await sha256Hex(stableStringify({ r: parts.runId, s: parts.step, t: parts.tool ?? "", a: parts.args ?? null }));
  return `idem_${digest.slice(0, 40)}`;
}

export class SqlIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly sql: SqlStore,
    private readonly clock: () => number = Date.now,
  ) {}

  async get(key: string): Promise<IdempotencyRecord | null> {
    const row = this.sql.exec<{ key: string; status: string; result: string | null; error: string | null }>(`SELECT key, status, result, error FROM as_idempotency WHERE key = ?`, key)[0];
    if (!row) return null;
    return {
      key: row.key,
      status: row.status as IdempotencyStatus,
      ...(row.result !== null ? { result: JSON.parse(row.result) as unknown } : {}),
      ...(row.error !== null ? { error: row.error } : {}),
    };
  }

  async start(key: string, meta: { runId: string; tool: string }): Promise<"started" | "exists"> {
    const existing = await this.get(key);
    if (existing && existing.status !== "FAILED") return "exists";
    this.sql.exec(
      `INSERT INTO as_idempotency (key, run_id, tool, status, created_at) VALUES (?, ?, ?, 'STARTED', ?)
       ON CONFLICT(key) DO UPDATE SET status = 'STARTED', error = NULL`,
      key,
      meta.runId,
      meta.tool,
      this.clock(),
    );
    return "started";
  }

  async complete(key: string, result: unknown): Promise<void> {
    this.sql.exec(`UPDATE as_idempotency SET status = 'COMPLETED', result = ?, completed_at = ? WHERE key = ?`, JSON.stringify(result ?? null), this.clock(), key);
  }

  async fail(key: string, error: string): Promise<void> {
    this.sql.exec(`UPDATE as_idempotency SET status = 'FAILED', error = ?, completed_at = ? WHERE key = ?`, error.slice(0, 4000), this.clock(), key);
  }

  async unknown(key: string, error: string): Promise<void> {
    this.sql.exec(`UPDATE as_idempotency SET status = 'UNKNOWN', error = ?, completed_at = ? WHERE key = ?`, error.slice(0, 4000), this.clock(), key);
  }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  async get(key: string) {
    return this.records.get(key) ?? null;
  }
  async start(key: string): Promise<"started" | "exists"> {
    const existing = this.records.get(key);
    if (existing && existing.status !== "FAILED") return "exists";
    this.records.set(key, { key, status: "STARTED" });
    return "started";
  }
  async complete(key: string, result: unknown) {
    this.records.set(key, { key, status: "COMPLETED", result });
  }
  async fail(key: string, error: string) {
    this.records.set(key, { key, status: "FAILED", error });
  }
  async unknown(key: string, error: string) {
    this.records.set(key, { key, status: "UNKNOWN", error });
  }
}
