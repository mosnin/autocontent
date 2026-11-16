import { AgentError } from "../errors.ts";
import type { ChatMessage } from "../models/types.ts";
import type { RunStatus } from "../observability/telemetry.ts";
import type { BlobStore, SqlStore } from "../storage/ports.ts";

export interface RunRecord {
  runId: string;
  tenantId: string;
  agent: string;
  objective: string;
  status: RunStatus;
  turnCount: number;
  costUsd: number;
  codeVersion: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  lastHeartbeatAt: number;
}

type RunRow = {
  run_id: string;
  tenant_id: string;
  agent: string;
  objective: string;
  status: string;
  turn_count: number;
  cost_usd: number;
  code_version: string;
  error: string | null;
  created_at: number;
  updated_at: number;
  last_heartbeat_at: number;
};

/**
 * Run registry + liveness ledger + checkpoints. The heartbeat sentinel reads
 * `stalled()` to detect silent deadlocks (ACTIVE but no cognitive step or tool
 * handshake within the threshold).
 */
export class RunStore {
  constructor(
    private readonly sql: SqlStore,
    private readonly clock: () => number = Date.now,
  ) {}

  upsert(run: { runId: string; tenantId: string; agent: string; objective?: string; status: RunStatus; codeVersion?: string }): RunRecord {
    const now = this.clock();
    this.sql.exec(
      `INSERT INTO as_runs (run_id, tenant_id, agent, objective, status, code_version, created_at, updated_at, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET status = excluded.status, objective = CASE WHEN excluded.objective = '' THEN as_runs.objective ELSE excluded.objective END, updated_at = excluded.updated_at, last_heartbeat_at = excluded.last_heartbeat_at`,
      run.runId,
      run.tenantId,
      run.agent,
      run.objective ?? "",
      run.status,
      run.codeVersion ?? "",
      now,
      now,
      now,
    );
    return this.get(run.runId) as RunRecord;
  }

  get(runId: string): RunRecord | null {
    const row = this.sql.exec<RunRow>(`SELECT * FROM as_runs WHERE run_id = ?`, runId)[0];
    return row ? fromRow(row) : null;
  }

  setStatus(runId: string, status: RunStatus, error: string | null = null): void {
    const now = this.clock();
    this.sql.exec(`UPDATE as_runs SET status = ?, error = ?, updated_at = ?, last_heartbeat_at = ? WHERE run_id = ?`, status, error, now, now, runId);
  }

  heartbeat(runId: string, counters?: { turnCount?: number; costUsd?: number }): void {
    const now = this.clock();
    if (counters) {
      this.sql.exec(
        `UPDATE as_runs SET last_heartbeat_at = ?, updated_at = ?, turn_count = COALESCE(?, turn_count), cost_usd = COALESCE(?, cost_usd) WHERE run_id = ?`,
        now,
        now,
        counters.turnCount ?? null,
        counters.costUsd ?? null,
        runId,
      );
    } else {
      this.sql.exec(`UPDATE as_runs SET last_heartbeat_at = ? WHERE run_id = ?`, now, runId);
    }
  }

  stalled(thresholdMs: number): RunRecord[] {
    return this.sql
      .exec<RunRow>(`SELECT * FROM as_runs WHERE status IN ('RUNNING', 'PROVISIONING') AND last_heartbeat_at < ?`, this.clock() - thresholdMs)
      .map(fromRow);
  }

  active(): RunRecord[] {
    return this.sql.exec<RunRow>(`SELECT * FROM as_runs WHERE status IN ('RUNNING', 'PROVISIONING', 'PENDING_APPROVAL', 'QUEUED')`).map(fromRow);
  }

  /** Append a checkpoint (e.g. transcript, loop state). Returns its sequence number. */
  checkpoint(runId: string, label: string, state: unknown): number {
    const seq = Number(this.sql.exec<{ s: number | null }>(`SELECT MAX(seq) AS s FROM as_checkpoints WHERE run_id = ?`, runId)[0]?.s ?? 0) + 1;
    this.sql.exec(`INSERT INTO as_checkpoints (run_id, seq, label, state_json, created_at) VALUES (?, ?, ?, ?, ?)`, runId, seq, label, JSON.stringify(state), this.clock());
    // Keep the ledger bounded: retain the latest 20 checkpoints per label.
    this.sql.exec(`DELETE FROM as_checkpoints WHERE run_id = ? AND label = ? AND seq <= ?`, runId, label, seq - 20);
    return seq;
  }

  latestCheckpoint<T>(runId: string, label: string): { seq: number; state: T } | null {
    const row = this.sql.exec<{ seq: number; state_json: string }>(`SELECT seq, state_json FROM as_checkpoints WHERE run_id = ? AND label = ? ORDER BY seq DESC LIMIT 1`, runId, label)[0];
    return row ? { seq: Number(row.seq), state: JSON.parse(row.state_json) as T } : null;
  }

  saveTranscript(runId: string, messages: ChatMessage[]): void {
    this.checkpoint(runId, "transcript", messages);
  }

  loadTranscript(runId: string): ChatMessage[] {
    return this.latestCheckpoint<ChatMessage[]>(runId, "transcript")?.state ?? [];
  }

  /** Dump the final stashed state to object storage for post-mortem debugging (budget halts, crashes). */
  async stashSnapshot(blobs: BlobStore, runId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const key = `snapshots/${runId}/${this.clock()}.json`;
    const snapshot = {
      run: this.get(runId),
      transcript: this.loadTranscript(runId),
      ledger: this.sql.exec(`SELECT * FROM as_budget_ledger WHERE run_id = ? ORDER BY id`, runId),
      scratchpad: this.sql.exec(`SELECT * FROM as_scratchpad WHERE run_id = ? ORDER BY id DESC LIMIT 5`, runId),
      reflections: this.sql.exec(`SELECT * FROM as_reflections WHERE run_id = ? ORDER BY id`, runId),
      goals: this.sql.exec(`SELECT * FROM as_goal_tree WHERE run_id = ?`, runId),
      ...extra,
    };
    await blobs.put(key, JSON.stringify(snapshot, null, 2), { contentType: "application/json" });
    return key;
  }
}

function fromRow(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    tenantId: row.tenant_id,
    agent: row.agent,
    objective: row.objective,
    status: row.status as RunStatus,
    turnCount: Number(row.turn_count),
    costUsd: Number(row.cost_usd),
    codeVersion: row.code_version,
    error: row.error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastHeartbeatAt: Number(row.last_heartbeat_at),
  };
}

/**
 * Durable steps with deterministic idempotency keys (fiber semantics). A step
 * that completed is never re-executed on replay; its recorded result is
 * returned instead.
 */
export class DurableSteps {
  constructor(
    private readonly sql: SqlStore,
    readonly runId: string,
    private readonly clock: () => number = Date.now,
  ) {}

  idempotencyKey(name: string): string {
    return `${this.runId}:${name}`;
  }

  async run<T>(name: string, fn: (ctx: { idempotencyKey: string; attempt: number }) => Promise<T>): Promise<T> {
    const row = this.sql.exec<{ status: string; result: string | null; attempts: number }>(`SELECT status, result, attempts FROM as_steps WHERE run_id = ? AND name = ?`, this.runId, name)[0];
    if (row?.status === "COMPLETED") return (row.result === null ? undefined : JSON.parse(row.result)) as T;
    const attempt = Number(row?.attempts ?? 0) + 1;
    this.sql.exec(
      `INSERT INTO as_steps (run_id, name, status, attempts, started_at) VALUES (?, ?, 'STARTED', ?, ?)
       ON CONFLICT(run_id, name) DO UPDATE SET status = 'STARTED', attempts = excluded.attempts, error = NULL`,
      this.runId,
      name,
      attempt,
      this.clock(),
    );
    try {
      const result = await fn({ idempotencyKey: this.idempotencyKey(name), attempt });
      this.sql.exec(`UPDATE as_steps SET status = 'COMPLETED', result = ?, completed_at = ? WHERE run_id = ? AND name = ?`, JSON.stringify(result ?? null), this.clock(), this.runId, name);
      return result;
    } catch (error) {
      this.sql.exec(`UPDATE as_steps SET status = 'FAILED', error = ? WHERE run_id = ? AND name = ?`, String(error).slice(0, 2000), this.runId, name);
      throw error;
    }
  }

  completed(): string[] {
    return this.sql.exec<{ name: string }>(`SELECT name FROM as_steps WHERE run_id = ? AND status = 'COMPLETED'`, this.runId).map((r) => r.name);
  }
}

export type VersionAction = "current" | "drain" | "handoff";

/**
 * Blue/green runtime versioning for long-lived agent instances. On boot a run
 * compares the code version it started under with the deployed version:
 * compatible → drain (finish on old semantics); incompatible → serialize state
 * and hand off to a fresh v2 instance.
 */
export class VersionGate {
  constructor(
    private readonly sql: SqlStore,
    private readonly codeVersion: string,
    private readonly isCompatible: (startedOn: string, current: string) => boolean = (a, b) => a.split(".")[0] === b.split(".")[0],
  ) {}

  check(runId: string): { action: VersionAction; startedOn: string } {
    const key = `version:${runId}`;
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM as_runtime_meta WHERE key = ?`, key)[0];
    if (!row) {
      this.sql.exec(`INSERT INTO as_runtime_meta (key, value, updated_at) VALUES (?, ?, ?)`, key, this.codeVersion, Date.now());
      return { action: "current", startedOn: this.codeVersion };
    }
    if (row.value === this.codeVersion) return { action: "current", startedOn: row.value };
    return { action: this.isCompatible(row.value, this.codeVersion) ? "drain" : "handoff", startedOn: row.value };
  }

  /** Throw a VERSION_HANDOFF error carrying the serialized state for the new instance. */
  handoff(runId: string, state: unknown): never {
    throw new AgentError("VERSION_HANDOFF", `Run ${runId} must hand off to a ${this.codeVersion} instance`, { details: { runId, state: JSON.stringify(state).slice(0, 100_000) } });
  }
}
