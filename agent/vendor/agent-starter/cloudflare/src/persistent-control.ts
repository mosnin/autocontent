import {
  agentIdentity,
  AgentError,
  applyConfigPatch,
  classifyProposal,
  type ConfigPatch,
  ConfigPatchSchema,
  type ConfigProposal,
  diffConfigs,
  inQuietHours,
  type MemoryEntry,
  MemorySourceSchema,
  type MemoryWriteInput,
  type MigrationSet,
  MigrationRunner,
  nextScheduleFire,
  PERSISTENT_AGENT_ID,
  PERSISTENT_MEMORY_MIGRATIONS,
  type PersistentAgentConfig,
  PersistentAgentConfigSchema,
  PersistentMemoryStore,
  type PersistentTrigger,
  quietHoursEnd,
  randomId,
  type SessionClaims,
  type SqlStore,
  summarizePatch,
  type TelemetryEvent,
  type TelemetrySink,
  TenantIdSchema,
  type TurnSummary,
  verifySessionToken,
} from "@agent-starter/core";
import { type Context, Hono } from "hono";

/**
 * Control plane of one persistent agent (trusted, deterministic): versioned config, proposals and their review,
 * the heartbeat/schedule alarm loop (quiet hours, single flight, skip records, daily budget), the kill switch, an
 * append-only audit log, turn summaries and provenance memory with snapshots. `PersistentAgentControl` (the
 * Durable Object in `durable-objects.ts`) wraps this engine; the agent itself never reaches it except through
 * `propose` / memory calls.
 */
export const PERSISTENT_CONTROL_MIGRATIONS: MigrationSet = {
  namespace: "agent-starter-persistent-control",
  migrations: [
    {
      version: 1,
      name: "persistent-control",
      up: [
        `CREATE TABLE IF NOT EXISTS as_pc_config (id INTEGER PRIMARY KEY CHECK (id = 1), tenant_id TEXT NOT NULL, config_json TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_pc_config_versions (version INTEGER PRIMARY KEY, config_json TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_pc_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS as_pc_proposals (
          id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, review TEXT NOT NULL,
          status TEXT NOT NULL, patch_json TEXT NOT NULL, base_version INTEGER NOT NULL, diff_json TEXT, reason TEXT, actor TEXT,
          decided_by TEXT, decided_at INTEGER, note TEXT)`,
        `CREATE INDEX IF NOT EXISTS as_pc_proposals_status ON as_pc_proposals(status, created_at)`,
        `CREATE TABLE IF NOT EXISTS as_pc_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL, data_json TEXT)`,
        `CREATE TABLE IF NOT EXISTS as_pc_turns (
          turn_id TEXT PRIMARY KEY, trigger TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL,
          tool_calls_json TEXT NOT NULL, reviews_json TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0)`,
        `CREATE INDEX IF NOT EXISTS as_pc_turns_started ON as_pc_turns(started_at)`,
      ],
      down: [`DROP TABLE IF EXISTS as_pc_turns`, `DROP TABLE IF EXISTS as_pc_audit`, `DROP TABLE IF EXISTS as_pc_proposals`, `DROP TABLE IF EXISTS as_pc_state`, `DROP TABLE IF EXISTS as_pc_config_versions`, `DROP TABLE IF EXISTS as_pc_config`],
    },
  ],
};

/** A turn still marked in flight after this long is considered lost: it is cleared and recorded as an error. */
export const STALE_TURN_MS = 15 * 60_000;
const MAX_TURNS = 500;
const MAX_AUDIT = 10_000;

export type AuditKind = "config" | "turn" | "review" | "kill" | "proposal" | "skip" | "memory";

export interface AuditEntry {
  id: number;
  at: number;
  kind: AuditKind;
  actor: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface PersistentStatus {
  enabled: boolean;
  killed: boolean;
  inFlight: boolean;
  nextTickAt: number | null;
  lastTickAt: number | null;
}

export interface PersistentControlState {
  config: PersistentAgentConfig | null;
  status: PersistentStatus;
  turns: TurnSummary[];
}

/** Who is acting: `user:<id>` (with admin flag), `agent:<t>/<a>` or `system`. */
export interface ControlActor {
  id: string;
  admin?: boolean;
}

export type PutConfigResult = { status: "created" | "applied"; config: PersistentAgentConfig } | { status: "proposed"; proposal: ConfigProposal };

/** Typed refusal with an HTTP status (the routes map it 1:1). */
export class ControlError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface PersistentControlEffects {
  /** Start one agent turn (fire-and-forget: the agent reports back through `recordTurn`). */
  dispatch(trigger: PersistentTrigger): Promise<void>;
  /** Arm (or clear, with null) the Durable Object alarm. */
  setAlarm(at: number | null): Promise<void>;
  now(): number;
  sinks?(): TelemetrySink[];
}

type ProposalRow = {
  id: string;
  created_at: number;
  source: string;
  kind: string;
  summary: string;
  review: string;
  status: string;
  patch_json: string;
  base_version: number;
  diff_json: string | null;
  reason: string | null;
  actor: string | null;
  decided_by: string | null;
  decided_at: number | null;
  note: string | null;
};

const toProposal = (r: ProposalRow): ConfigProposal => ({
  id: r.id,
  createdAt: Number(r.created_at),
  source: r.source as ConfigProposal["source"],
  kind: r.kind as ConfigProposal["kind"],
  summary: r.summary,
  review: r.review as ConfigProposal["review"],
  status: r.status as ConfigProposal["status"],
  patch: JSON.parse(r.patch_json) as ConfigPatch,
  baseVersion: Number(r.base_version),
  ...(r.diff_json ? { diff: JSON.parse(r.diff_json) as ConfigProposal["diff"] } : {}),
  ...(r.reason ? { reason: r.reason } : {}),
  ...(r.actor ? { actor: r.actor } : {}),
  ...(r.decided_by ? { decidedBy: r.decided_by } : {}),
  ...(r.decided_at ? { decidedAt: Number(r.decided_at) } : {}),
  ...(r.note ? { note: r.note } : {}),
});

type TurnRow = { turn_id: string; trigger: string; started_at: number; ended_at: number | null; outcome: string; tool_calls_json: string; reviews_json: string; cost_usd: number };
const toTurn = (r: TurnRow): TurnSummary => ({
  turnId: r.turn_id,
  trigger: r.trigger,
  startedAt: Number(r.started_at),
  ...(r.ended_at ? { endedAt: Number(r.ended_at) } : {}),
  outcome: r.outcome as TurnSummary["outcome"],
  toolCalls: JSON.parse(r.tool_calls_json) as string[],
  reviews: JSON.parse(r.reviews_json) as TurnSummary["reviews"],
  costUsd: Number(r.cost_usd),
});

/** Fields an owner may set through PUT /config (as a patch); skills change only through proposals. */
const PUT_FIELDS = ["name", "heartbeat", "heartbeatMinutes", "schedules", "egress", "credentials", "dailyBudgetUsd", "maxToolCallsPerTick", "autoReview"] as const;

export class PersistentControlEngine {
  readonly memory: PersistentMemoryStore;

  constructor(
    private readonly sql: SqlStore,
    private readonly effects: PersistentControlEffects,
  ) {
    const runner = new MigrationRunner(sql);
    runner.migrateUp(PERSISTENT_CONTROL_MIGRATIONS);
    runner.migrateUp(PERSISTENT_MEMORY_MIGRATIONS);
    this.memory = new PersistentMemoryStore(sql, { clock: () => effects.now() });
  }

  // ---- state helpers --------------------------------------------------------
  private getState<T>(key: string): T | null {
    const row = this.sql.exec<{ value: string }>(`SELECT value FROM as_pc_state WHERE key = ?`, key)[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  private setState(key: string, value: unknown): void {
    if (value === null || value === undefined) this.sql.exec(`DELETE FROM as_pc_state WHERE key = ?`, key);
    else this.sql.exec(`INSERT INTO as_pc_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, JSON.stringify(value));
  }

  tenantId(): string | null {
    return this.sql.exec<{ tenant_id: string }>(`SELECT tenant_id FROM as_pc_config WHERE id = 1`)[0]?.tenant_id ?? null;
  }

  config(): PersistentAgentConfig | null {
    const row = this.sql.exec<{ config_json: string }>(`SELECT config_json FROM as_pc_config WHERE id = 1`)[0];
    return row ? PersistentAgentConfigSchema.parse(JSON.parse(row.config_json)) : null;
  }

  isKilled(): boolean {
    const config = this.config();
    return this.getState<boolean>("killed") === true || (config !== null && !config.enabled);
  }

  // ---- audit ----------------------------------------------------------------
  audit(kind: AuditKind, actor: string, summary: string, data?: Record<string, unknown>): void {
    this.sql.exec(`INSERT INTO as_pc_audit (at, kind, actor, summary, data_json) VALUES (?, ?, ?, ?, ?)`, this.effects.now(), kind, actor.slice(0, 300), summary.slice(0, 500), data ? JSON.stringify(data).slice(0, 8000) : null);
    this.sql.exec(`DELETE FROM as_pc_audit WHERE id <= (SELECT MAX(id) FROM as_pc_audit) - ?`, MAX_AUDIT);
    void this.emit(kind, summary, data);
  }

  /** Newest first; `cursor` is the last id of the previous page. */
  readAudit(cursor?: number | null, limit = 50): { entries: AuditEntry[]; nextCursor?: number } {
    const n = Math.min(200, Math.max(1, Math.floor(limit) || 50));
    const rows = this.sql.exec<{ id: number; at: number; kind: string; actor: string; summary: string; data_json: string | null }>(
      `SELECT * FROM as_pc_audit ${cursor ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`,
      ...(cursor ? [cursor, n + 1] : [n + 1]),
    );
    const entries = rows.slice(0, n).map((r) => ({ id: Number(r.id), at: Number(r.at), kind: r.kind as AuditKind, actor: r.actor, summary: r.summary, ...(r.data_json ? { data: JSON.parse(r.data_json) as Record<string, unknown> } : {}) }));
    return rows.length > n ? { entries, nextCursor: entries[entries.length - 1]?.id as number } : { entries };
  }

  private async emit(kind: AuditKind, content: string, data?: Record<string, unknown>): Promise<void> {
    const sinks = this.effects.sinks?.() ?? [];
    if (!sinks.length) return;
    const config = this.config();
    const event: TelemetryEvent = {
      id: randomId("evt"),
      type: kind === "turn" ? "turn" : kind === "review" || kind === "proposal" ? "approval" : kind === "kill" ? "status" : "log",
      runId: config ? `persistent:${config.agentId}` : "persistent",
      tenantId: this.tenantId() ?? "unknown",
      senderId: config ? agentIdentity(this.tenantId() ?? "unknown", config.agentId, config.ownerUserId).principal : "control-plane",
      senderRole: "persistent-control",
      content: content.slice(0, 500),
      logType: kind === "kill" || kind === "skip" ? "warning" : "info",
      turnCount: 0,
      accumulatedCost: 0,
      runtimeSeconds: 0,
      timestamp: this.effects.now(),
      data: { persistent: kind, ...(data ?? {}) },
    };
    await Promise.allSettled(sinks.map((s) => s.publish(event)));
  }

  // ---- config ---------------------------------------------------------------
  private commit(tenantId: string, config: PersistentAgentConfig, actor: string, summary: string, before: PersistentAgentConfig | null): PersistentAgentConfig {
    const now = this.effects.now();
    const committed = PersistentAgentConfigSchema.parse({ ...config, version: before ? before.version + 1 : 1 });
    this.sql.exec(
      `INSERT INTO as_pc_config (id, tenant_id, config_json, version, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, version = excluded.version, updated_at = excluded.updated_at`,
      tenantId,
      JSON.stringify(committed),
      committed.version,
      now,
    );
    this.sql.exec(`INSERT OR REPLACE INTO as_pc_config_versions (version, config_json, actor, created_at) VALUES (?, ?, ?, ?)`, committed.version, JSON.stringify(committed), actor, now);
    this.audit("config", actor, `${summary} (v${committed.version})`, { version: committed.version, diff: before ? diffConfigs(before, committed).map((d) => d.field) : ["created"] });
    this.reschedule(before, committed);
    return committed;
  }

  /** Earlier versions (newest first) for review and manual rollback. */
  configVersions(limit = 20): Array<{ version: number; actor: string; createdAt: number; config: PersistentAgentConfig }> {
    return this.sql
      .exec<{ version: number; config_json: string; actor: string; created_at: number }>(`SELECT * FROM as_pc_config_versions ORDER BY version DESC LIMIT ?`, Math.min(100, limit))
      .map((r) => ({ version: Number(r.version), actor: r.actor, createdAt: Number(r.created_at), config: JSON.parse(r.config_json) as PersistentAgentConfig }));
  }

  /**
   * Create (expectedVersion 0, no config yet) or change the config. A change `classifyProposal` marks "human"
   * becomes a pending owner proposal instead. `agentId`, `enabled` and `version` are never taken from the input;
   * `ownerUserId` only from an admin (applied directly: the admin is the human decision).
   */
  putConfig(tenantId: string, agentId: string, input: unknown, expectedVersion: number, actor: ControlActor & { userId: string }): PutConfigResult {
    const current = this.config();
    const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    if (!current) {
      if (expectedVersion !== 0) throw new ControlError(409, "VERSION_CONFLICT", "No config exists yet: create it with expectedVersion 0.", { currentVersion: 0 });
      const owner = actor.admin && typeof body.ownerUserId === "string" && body.ownerUserId ? body.ownerUserId : actor.userId;
      const parsed = PersistentAgentConfigSchema.safeParse({ ...body, agentId, ownerUserId: owner, enabled: true, version: 1, skills: [] });
      if (!parsed.success) throw new ControlError(400, "INVALID", "Invalid config", { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      const config = this.commit(tenantId, parsed.data, actor.id, "config created", null);
      return { status: "created", config };
    }
    if (expectedVersion !== current.version) throw new ControlError(409, "VERSION_CONFLICT", "The config changed since you read it.", { currentVersion: current.version });
    let base = current;
    if (actor.admin && typeof body.ownerUserId === "string" && body.ownerUserId && body.ownerUserId !== current.ownerUserId) {
      base = this.commit(tenantId, { ...current, ownerUserId: body.ownerUserId }, actor.id, `owner changed to user:${body.ownerUserId}`, current);
    }
    const patch: Record<string, unknown> = {};
    for (const field of PUT_FIELDS) if (field in body && JSON.stringify(body[field]) !== JSON.stringify(base[field])) patch[field] = body[field];
    if ("quietHours" in body && JSON.stringify(body.quietHours ?? null) !== JSON.stringify(base.quietHours ?? null)) patch.quietHours = body.quietHours ?? null;
    const parsedPatch = ConfigPatchSchema.safeParse(patch);
    if (!parsedPatch.success) throw new ControlError(400, "INVALID", "Invalid config", { issues: parsedPatch.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    if (Object.keys(parsedPatch.data).length === 0) return { status: "applied", config: base };
    const outcome = this.propose({ patch: parsedPatch.data, reason: "owner edit", source: "owner", actor: actor.id });
    if (outcome.status === "applied") return { status: "applied", config: this.config() as PersistentAgentConfig };
    return { status: "proposed", proposal: outcome };
  }

  // ---- proposals --------------------------------------------------------------
  /**
   * Record a proposal. Low-risk ("auto") proposals are applied at once (status `applied`); anything that widens
   * access, and every skill, waits for a human (`pending`). The agent's tools only ever reach this method.
   */
  propose(input: { patch: unknown; reason?: string; source: "agent" | "owner"; actor: string }): ConfigProposal {
    const current = this.config();
    if (!current) throw new ControlError(404, "NOT_CONFIGURED", "No config exists yet.");
    const patch = ConfigPatchSchema.safeParse(input.patch);
    if (!patch.success) throw new ControlError(400, "INVALID", "Invalid proposal", { issues: patch.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    let next: PersistentAgentConfig;
    try {
      next = applyConfigPatch(current, patch.data);
    } catch (error) {
      throw new ControlError(400, "INVALID", error instanceof Error ? error.message.slice(0, 500) : "Invalid proposal");
    }
    const review = classifyProposal(current, next);
    const kind = patch.data.addSkill || patch.data.removeSkill ? "skill" : "config";
    const proposal: ConfigProposal = {
      id: randomId("prop"),
      createdAt: this.effects.now(),
      source: input.source,
      kind,
      summary: summarizePatch(patch.data),
      review,
      status: "pending",
      patch: patch.data,
      baseVersion: current.version,
      diff: diffConfigs(current, next).map((d) => (d.field === "skills" ? { field: d.field, before: skillNames(d.before), after: skillNames(d.after) } : d)),
      ...(input.reason ? { reason: input.reason.slice(0, 2000) } : {}),
      actor: input.actor,
    };
    this.insertProposal(proposal);
    this.audit("proposal", input.actor, `${input.source} proposed: ${proposal.summary} (${review} review)`, { proposalId: proposal.id, review, kind });
    if (review === "auto") return this.applyProposal(proposal, "system:auto-review");
    return proposal;
  }

  private insertProposal(p: ConfigProposal): void {
    this.sql.exec(
      `INSERT INTO as_pc_proposals (id, created_at, source, kind, summary, review, status, patch_json, base_version, diff_json, reason, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id,
      p.createdAt,
      p.source,
      p.kind,
      p.summary,
      p.review,
      p.status,
      JSON.stringify(p.patch),
      p.baseVersion,
      p.diff ? JSON.stringify(p.diff) : null,
      p.reason ?? null,
      p.actor ?? null,
    );
  }

  private applyProposal(proposal: ConfigProposal, decidedBy: string, note?: string): ConfigProposal {
    const current = this.config() as PersistentAgentConfig;
    let next: PersistentAgentConfig;
    try {
      next = applyConfigPatch(current, proposal.patch);
    } catch (error) {
      throw new ControlError(409, "STALE_PROPOSAL", `The proposal no longer applies: ${error instanceof Error ? error.message.slice(0, 300) : "invalid"}`);
    }
    this.commit(this.tenantId() as string, next, decidedBy, `proposal ${proposal.id} applied: ${proposal.summary}`, current);
    const now = this.effects.now();
    this.sql.exec(`UPDATE as_pc_proposals SET status = 'applied', decided_by = ?, decided_at = ?, note = ? WHERE id = ?`, decidedBy, now, note ?? null, proposal.id);
    return { ...proposal, status: "applied", decidedBy, decidedAt: now, ...(note ? { note } : {}) };
  }

  listProposals(status?: ConfigProposal["status"], limit = 100): ConfigProposal[] {
    const rows = status
      ? this.sql.exec<ProposalRow>(`SELECT * FROM as_pc_proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?`, status, Math.min(500, limit))
      : this.sql.exec<ProposalRow>(`SELECT * FROM as_pc_proposals ORDER BY created_at DESC LIMIT ?`, Math.min(500, limit));
    return rows.map(toProposal);
  }

  decideProposal(id: string, decision: "approve" | "reject", actor: string, note?: string): { proposal: ConfigProposal; config?: PersistentAgentConfig } {
    const row = this.sql.exec<ProposalRow>(`SELECT * FROM as_pc_proposals WHERE id = ?`, id)[0];
    if (!row) throw new ControlError(404, "NOT_FOUND", "Unknown proposal");
    const proposal = toProposal(row);
    if (proposal.status !== "pending") throw new ControlError(409, "NOT_PENDING", `Proposal is already ${proposal.status}`);
    const cleanNote = note?.slice(0, 2000);
    if (decision === "reject") {
      const now = this.effects.now();
      this.sql.exec(`UPDATE as_pc_proposals SET status = 'rejected', decided_by = ?, decided_at = ?, note = ? WHERE id = ?`, actor, now, cleanNote ?? null, id);
      this.audit("proposal", actor, `proposal ${id} rejected: ${proposal.summary}`, { proposalId: id });
      return { proposal: { ...proposal, status: "rejected", decidedBy: actor, decidedAt: now, ...(cleanNote ? { note: cleanNote } : {}) } };
    }
    this.sql.exec(`UPDATE as_pc_proposals SET status = 'approved' WHERE id = ?`, id);
    this.audit("proposal", actor, `proposal ${id} approved: ${proposal.summary}`, { proposalId: id });
    const applied = this.applyProposal(proposal, actor, cleanNote);
    return { proposal: applied, config: this.config() as PersistentAgentConfig };
  }

  // ---- kill switch --------------------------------------------------------------
  async disable(actor: string): Promise<PersistentStatus> {
    this.setState("killed", true);
    this.audit("kill", actor, "agent disabled (kill switch on)");
    await this.effects.setAlarm(null);
    return this.status();
  }

  async enable(actor: string): Promise<PersistentStatus> {
    this.setState("killed", null);
    this.audit("kill", actor, "agent enabled (kill switch off)");
    await this.arm();
    return this.status();
  }

  // ---- turns and reviews -----------------------------------------------------------
  recordTurn(summary: TurnSummary): void {
    const clean: TurnSummary = {
      turnId: String(summary.turnId).slice(0, 100),
      trigger: String(summary.trigger).slice(0, 60),
      startedAt: Number(summary.startedAt) || this.effects.now(),
      endedAt: Number(summary.endedAt) || this.effects.now(),
      outcome: (["ok", "heartbeat_ok", "skipped", "error", "killed"] as const).includes(summary.outcome) ? summary.outcome : "error",
      toolCalls: (summary.toolCalls ?? []).slice(0, 200).map((t) => String(t).slice(0, 64)),
      reviews: (summary.reviews ?? []).slice(0, 200).map((r) => ({ tool: String(r.tool).slice(0, 64), decision: r.decision, reason: String(r.reason).slice(0, 300) })),
      costUsd: Math.max(0, Number(summary.costUsd) || 0),
    };
    this.sql.exec(
      `INSERT OR REPLACE INTO as_pc_turns (turn_id, trigger, started_at, ended_at, outcome, tool_calls_json, reviews_json, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      clean.turnId,
      clean.trigger,
      clean.startedAt,
      clean.endedAt ?? null,
      clean.outcome,
      JSON.stringify(clean.toolCalls),
      JSON.stringify(clean.reviews),
      clean.costUsd,
    );
    this.sql.exec(`DELETE FROM as_pc_turns WHERE turn_id IN (SELECT turn_id FROM as_pc_turns ORDER BY started_at DESC LIMIT -1 OFFSET ?)`, MAX_TURNS);
    const inFlight = this.getState<{ turnId: string; startedAt: number }>("inFlight");
    if (inFlight && inFlight.turnId === clean.turnId) this.setState("inFlight", null);
    this.audit("turn", this.principal(), `turn ${clean.turnId} (${clean.trigger}): ${clean.outcome}, ${clean.toolCalls.length} tool call(s), $${clean.costUsd.toFixed(4)}`, {
      turnId: clean.turnId,
      trigger: clean.trigger,
      outcome: clean.outcome,
      tools: clean.toolCalls,
      reviews: clean.reviews.map((r) => ({ tool: r.tool, decision: r.decision })),
      costUsd: clean.costUsd,
    });
  }

  recordReview(entry: { turnId?: string; tool: string; decision: "approve" | "block" | "escalate"; reason: string; by?: string }): void {
    this.audit("review", "system:auto-review", `${entry.decision} ${entry.tool}: ${entry.reason}`.slice(0, 500), { turnId: entry.turnId, tool: entry.tool, decision: entry.decision, by: entry.by });
  }

  turns(limit = 20): TurnSummary[] {
    return this.sql.exec<TurnRow>(`SELECT * FROM as_pc_turns ORDER BY started_at DESC LIMIT ?`, Math.min(200, limit)).map(toTurn);
  }

  /** Spend recorded today (UTC) from turn summaries. */
  spentToday(): number {
    const now = this.effects.now();
    const dayStart = now - (now % 86_400_000);
    return Number(this.sql.exec<{ c: number | null }>(`SELECT SUM(cost_usd) AS c FROM as_pc_turns WHERE started_at >= ?`, dayStart)[0]?.c ?? 0);
  }

  private principal(): string {
    const config = this.config();
    const tenant = this.tenantId();
    return config && tenant ? agentIdentity(tenant, config.agentId, config.ownerUserId).principal : "agent:unknown";
  }

  status(): PersistentStatus {
    const config = this.config();
    const killed = this.isKilled();
    return { enabled: Boolean(config?.enabled) && !killed, killed, inFlight: this.getState("inFlight") !== null, nextTickAt: killed ? null : this.nextWake(), lastTickAt: this.getState<number>("lastTickAt") };
  }

  state(): PersistentControlState {
    return { config: this.config(), status: this.status(), turns: this.turns(20) };
  }

  // ---- memory --------------------------------------------------------------------
  memoryWrite(input: MemoryWriteInput): MemoryEntry {
    const source = MemorySourceSchema.safeParse(input.source);
    if (!source.success) throw new ControlError(400, "INVALID", "Invalid memory source");
    // Only the owner route may write as "owner": the agent's own writes are forced to "agent" by its tool and port.
    return this.memory.write({ ...input, source: source.data });
  }

  memorySnapshot(actor: string) {
    const snapshot = this.memory.snapshot();
    this.audit("memory", actor, `memory snapshot ${snapshot.id} (${snapshot.entries} entries)`, { snapshotId: snapshot.id });
    return snapshot;
  }

  memoryRollback(snapshotId: string, actor: string): number {
    let restored: number;
    try {
      restored = this.memory.rollback(snapshotId);
    } catch {
      throw new ControlError(404, "NOT_FOUND", "Unknown snapshot");
    }
    this.audit("memory", actor, `memory rolled back to ${snapshotId} (${restored} entries)`, { snapshotId, restored });
    return restored;
  }

  // ---- alarm loop ------------------------------------------------------------------
  private schedules(): Record<string, number> {
    return this.getState<Record<string, number>>("scheduleNext") ?? {};
  }

  private nextWake(): number | null {
    const candidates = [this.getState<number>("heartbeatNext"), ...Object.values(this.schedules())].filter((v): v is number => typeof v === "number");
    const inFlight = this.getState<{ startedAt: number }>("inFlight");
    if (inFlight) candidates.push(inFlight.startedAt + STALE_TURN_MS);
    return candidates.length ? Math.min(...candidates) : null;
  }

  private reschedule(before: PersistentAgentConfig | null, after: PersistentAgentConfig): void {
    const now = this.effects.now();
    const heartbeat = this.getState<number>("heartbeatNext");
    const fromLast = (this.getState<number>("lastTickAt") ?? now) + after.heartbeatMinutes * 60_000;
    if (heartbeat === null || !before || before.heartbeatMinutes !== after.heartbeatMinutes) this.setState("heartbeatNext", Math.max(now + 60_000, Math.min(fromLast, now + after.heartbeatMinutes * 60_000)));
    const previous = new Map((before?.schedules ?? []).map((s) => [s.name, s.cron]));
    const next: Record<string, number> = {};
    const current = this.schedules();
    for (const s of after.schedules) {
      next[s.name] = previous.get(s.name) === s.cron && typeof current[s.name] === "number" ? (current[s.name] as number) : nextScheduleFire(s.cron, now, after.quietHours?.tz);
    }
    this.setState("scheduleNext", next);
  }

  /** Re-arm the alarm for the next wake-up (no-op while killed or unconfigured). */
  async arm(): Promise<number | null> {
    if (!this.config() || this.isKilled()) {
      await this.effects.setAlarm(null);
      return null;
    }
    if (this.getState("heartbeatNext") === null) this.reschedule(null, this.config() as PersistentAgentConfig);
    const at = this.nextWake();
    await this.effects.setAlarm(at === null ? null : Math.max(at, this.effects.now() + 1_000));
    return at;
  }

  private recordSkip(trigger: string, reason: string): void {
    const now = this.effects.now();
    const turnId = randomId("skip");
    this.sql.exec(`INSERT INTO as_pc_turns (turn_id, trigger, started_at, ended_at, outcome, tool_calls_json, reviews_json, cost_usd) VALUES (?, ?, ?, ?, 'skipped', '[]', '[]', 0)`, turnId, trigger, now, now);
    this.audit("skip", "system", `tick skipped (${trigger}): ${reason}`, { trigger, reason });
  }

  /**
   * One alarm: clear a lost in-flight turn, then for every due trigger either dispatch it (at most one; the rest
   * are skipped and recorded while it runs), defer it past quiet hours, or skip it (in flight, daily budget spent).
   * The kill switch stops the loop entirely (no dispatch, no re-arm).
   */
  async onAlarm(): Promise<void> {
    const config = this.config();
    const tenantId = this.tenantId();
    if (!config || !tenantId || this.isKilled()) {
      await this.effects.setAlarm(null);
      return;
    }
    const now = this.effects.now();
    let inFlight = this.getState<{ turnId: string; startedAt: number; trigger: string }>("inFlight");
    if (inFlight && now - inFlight.startedAt >= STALE_TURN_MS) {
      this.recordTurn({ turnId: inFlight.turnId, trigger: inFlight.trigger, startedAt: inFlight.startedAt, endedAt: now, outcome: "error", toolCalls: [], reviews: [], costUsd: 0 });
      this.audit("skip", "system", `turn ${inFlight.turnId} lost (no summary after ${STALE_TURN_MS / 60_000} min); cleared`);
      this.setState("inFlight", null);
      inFlight = null;
    }
    type Due = { kind: "heartbeat" | "schedule"; name?: string; prompt: string; label: string };
    const due: Due[] = [];
    const heartbeatNext = this.getState<number>("heartbeatNext");
    if (heartbeatNext !== null && heartbeatNext <= now) due.push({ kind: "heartbeat", prompt: config.heartbeat, label: "heartbeat" });
    const scheduleNext = this.schedules();
    for (const s of config.schedules) if ((scheduleNext[s.name] ?? Number.POSITIVE_INFINITY) <= now) due.push({ kind: "schedule", name: s.name, prompt: s.prompt, label: `schedule:${s.name}` });

    const advance = (d: Due, at?: number) => {
      if (d.kind === "heartbeat") this.setState("heartbeatNext", at ?? now + config.heartbeatMinutes * 60_000);
      else {
        const s = config.schedules.find((x) => x.name === d.name);
        if (s) this.setState("scheduleNext", { ...this.schedules(), [s.name]: at ?? nextScheduleFire(s.cron, now, config.quietHours?.tz) });
      }
    };

    let dispatched = false;
    for (const d of due) {
      if (inQuietHours(now, config.quietHours)) {
        advance(d, quietHoursEnd(now, config.quietHours));
        this.audit("skip", "system", `tick deferred (${d.label}): quiet hours`, { trigger: d.label, reason: "quiet_hours" });
        continue;
      }
      if (inFlight || dispatched) {
        advance(d);
        this.recordSkip(d.label, "a turn is still in flight");
        continue;
      }
      if (this.spentToday() >= config.dailyBudgetUsd) {
        advance(d);
        this.recordSkip(d.label, "daily budget reached");
        continue;
      }
      advance(d);
      const turnId = randomId("turn");
      this.setState("inFlight", { turnId, startedAt: now, trigger: d.label });
      this.setState("lastTickAt", now);
      dispatched = true;
      try {
        await this.effects.dispatch({ turnId, kind: d.kind, ...(d.name ? { name: d.name } : {}), prompt: d.prompt, config, identity: agentIdentity(tenantId, config.agentId, config.ownerUserId) });
      } catch (error) {
        this.recordTurn({ turnId, trigger: d.label, startedAt: now, endedAt: this.effects.now(), outcome: "error", toolCalls: [], reviews: [], costUsd: 0 });
        this.audit("skip", "system", `dispatch failed (${d.label}): ${error instanceof Error ? error.message.slice(0, 200) : "error"}`);
      }
    }
    await this.arm();
  }
}

function skillNames(value: unknown): string[] {
  return Array.isArray(value) ? value.map((s) => String((s as { name?: unknown }).name ?? "")) : [];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** The RPC surface the routes need (a `PersistentAgentControl` stub). */
export interface PersistentControlApi {
  getState(): Promise<PersistentControlState>;
  getConfig(): Promise<PersistentAgentConfig | null>;
  putConfig(tenantId: string, agentId: string, config: unknown, expectedVersion: number, actor: ControlActor & { userId: string }): Promise<PutConfigResult | { error: ControlErrorShape }>;
  listProposals(status?: ConfigProposal["status"]): Promise<ConfigProposal[]>;
  decideProposal(id: string, decision: "approve" | "reject", actor: string, note?: string): Promise<{ proposal: ConfigProposal; config?: PersistentAgentConfig } | { error: ControlErrorShape }>;
  disable(actor: string): Promise<PersistentStatus>;
  enable(actor: string): Promise<PersistentStatus>;
  readAudit(cursor?: number | null, limit?: number): Promise<{ entries: AuditEntry[]; nextCursor?: number }>;
  memorySnapshot(actor: string): Promise<{ id: string; takenAt: number; entries: number }>;
  memorySnapshots(): Promise<Array<{ id: string; takenAt: number; entries: number }>>;
  memoryRollback(snapshotId: string, actor: string): Promise<number | { error: ControlErrorShape }>;
}

/** A `ControlError` as it crosses the RPC boundary (Durable Object RPC does not preserve error classes). */
export interface ControlErrorShape {
  status: 400 | 403 | 404 | 409;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}

export function toControlErrorShape(error: unknown): ControlErrorShape {
  if (error instanceof ControlError) return { status: error.status, code: error.code, message: error.message, extra: error.extra };
  if (error instanceof AgentError) return { status: 400, code: "INVALID", message: error.message };
  throw error;
}

export interface PersistentControlRoutesOptions<Env extends object> {
  namespace: (env: Env) => DurableObjectNamespace;
  sessionSecrets: (c: Context<{ Bindings: Env }>) => string | string[];
  /** Roles that may read the audit log. Default ["security", "admin"]. */
  securityRoles?: string[];
  /** Roles that manage any persistent agent of their tenant. Default ["admin"]. */
  adminRoles?: string[];
  /** Roles that may CREATE a persistent agent (it spends money on its own). Default: `adminRoles`. */
  creatorRoles?: string[];
  /** Override the stub lookup (tests). */
  control?: (c: Context<{ Bindings: Env }>, name: string) => PersistentControlApi;
}

/** Durable Object name of a persistent agent's control plane: `${tenantId}/${agentId}` (tenant from the session). */
export function persistentControlName(tenantId: string, agentId: string): string {
  return `${tenantId}/${agentId}`;
}

/**
 * Session-authenticated management routes for persistent agents, all under `/api/persistent/:agentId`. The tenant
 * always comes from the session (`tid`), never the URL. Owner (config.ownerUserId === sub) or admin for
 * management, a creator role to create, a security role for the audit log. 401/403 are explicit JSON errors.
 */
export function createPersistentControlRoutes<Env extends object>(options: PersistentControlRoutesOptions<Env>) {
  const app = new Hono<{ Bindings: Env }>();
  const adminRoles = options.adminRoles ?? ["admin"];
  const securityRoles = options.securityRoles ?? ["security", "admin"];
  const creatorRoles = options.creatorRoles ?? adminRoles;
  type Ctx = Context<{ Bindings: Env }>;

  const stub = (c: Ctx, tenantId: string, agentId: string): PersistentControlApi => {
    const name = persistentControlName(tenantId, agentId);
    if (options.control) return options.control(c, name);
    const ns = options.namespace(c.env);
    return ns.get(ns.idFromName(name)) as unknown as PersistentControlApi;
  };
  const fail = (c: Ctx, e: ControlErrorShape) => c.json({ error: e.code, message: e.message, ...(e.extra ?? {}) }, e.status);
  const isError = (v: unknown): v is { error: ControlErrorShape } => Boolean(v && typeof v === "object" && "error" in v && typeof (v as { error: unknown }).error === "object");

  type Guarded = { claims: SessionClaims; agentId: string; api: PersistentControlApi; admin: boolean; actor: string };
  const authenticate = async (c: Ctx): Promise<Guarded | Response> => {
    let claims: SessionClaims;
    try {
      claims = await verifySessionToken(options.sessionSecrets(c), c.req.header("authorization"));
    } catch {
      return c.json({ error: "UNAUTHENTICATED", message: "A valid session token is required." }, 401);
    }
    if (!TenantIdSchema.safeParse(claims.tid).success) return c.json({ error: "UNAUTHENTICATED", message: "Invalid tenant." }, 401);
    const agentId = c.req.param("agentId") ?? "";
    if (!PERSISTENT_AGENT_ID.test(agentId)) return c.json({ error: "INVALID", issues: ["agentId: invalid"] }, 400);
    return { claims, agentId, api: stub(c, claims.tid, agentId), admin: claims.roles.some((r) => adminRoles.includes(r)), actor: `user:${claims.sub}` };
  };
  /** Owner or admin of a configured agent. */
  const manage = async (c: Ctx): Promise<(Guarded & { config: PersistentAgentConfig }) | Response> => {
    const g = await authenticate(c);
    if (g instanceof Response) return g;
    const config = await g.api.getConfig();
    if (!config) return g.admin ? c.json({ error: "NOT_CONFIGURED" }, 404) : c.json({ error: "FORBIDDEN", reason: "owner or admin role required" }, 403);
    if (!g.admin && config.ownerUserId !== g.claims.sub) return c.json({ error: "FORBIDDEN", reason: "owner or admin role required" }, 403);
    return { ...g, config };
  };
  const jsonBody = async (c: Ctx): Promise<Record<string, unknown>> => {
    try {
      const body = await c.req.json();
      return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  app.get("/api/persistent/:agentId", async (c) => {
    const g = await manage(c);
    if (g instanceof Response) return g;
    return c.json(await g.api.getState());
  });

  app.put("/api/persistent/:agentId/config", async (c) => {
    const g = await authenticate(c);
    if (g instanceof Response) return g;
    const body = await jsonBody(c);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) return c.json({ error: "INVALID", issues: ["expectedVersion: required integer"] }, 400);
    const current = await g.api.getConfig();
    if (!current) {
      if (!g.claims.roles.some((r) => creatorRoles.includes(r))) return c.json({ error: "FORBIDDEN", reason: "creator role required" }, 403);
    } else if (!g.admin && current.ownerUserId !== g.claims.sub) {
      return c.json({ error: "FORBIDDEN", reason: "owner or admin role required" }, 403);
    }
    const result = await g.api.putConfig(g.claims.tid, g.agentId, body.config, expectedVersion, { id: g.actor, userId: g.claims.sub, admin: g.admin });
    if (isError(result)) return fail(c, result.error);
    if (result.status === "proposed") return c.json({ proposal: result.proposal }, 202);
    return c.json({ config: result.config }, result.status === "created" ? 201 : 200);
  });

  app.get("/api/persistent/:agentId/proposals", async (c) => {
    const g = await manage(c);
    if (g instanceof Response) return g;
    const status = c.req.query("status");
    const valid = status === "pending" || status === "approved" || status === "rejected" || status === "applied" ? status : undefined;
    return c.json({ proposals: await g.api.listProposals(valid) });
  });

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/api/persistent/:agentId/proposals/:id/${decision}`, async (c) => {
      const g = await manage(c);
      if (g instanceof Response) return g;
      const body = await jsonBody(c);
      const result = await g.api.decideProposal(c.req.param("id") ?? "", decision, g.actor, typeof body.note === "string" ? body.note : undefined);
      if (isError(result)) return fail(c, result.error);
      return c.json(result);
    });
  }

  app.post("/api/persistent/:agentId/disable", async (c) => {
    const g = await manage(c);
    if (g instanceof Response) return g;
    return c.json({ status: await g.api.disable(g.actor) });
  });

  app.post("/api/persistent/:agentId/enable", async (c) => {
    const g = await manage(c);
    if (g instanceof Response) return g;
    return c.json({ status: await g.api.enable(g.actor) });
  });

  app.get("/api/persistent/:agentId/audit", async (c) => {
    const g = await authenticate(c);
    if (g instanceof Response) return g;
    if (!g.claims.roles.some((r) => securityRoles.includes(r))) return c.json({ error: "FORBIDDEN", reason: "security role required" }, 403);
    const cursor = Number(c.req.query("cursor"));
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json(await g.api.readAudit(Number.isInteger(cursor) && cursor > 0 ? cursor : null, Number.isFinite(limit) ? limit : 50));
  });

  app.post("/api/persistent/:agentId/memory/snapshot", async (c) => {
    const g = await manage(c);
    if (g instanceof Response) return g;
    return c.json({ snapshot: await g.api.memorySnapshot(g.actor) });
  });

  app.get("/api/persistent/:agentId/memory/snapshots", async (c) => {
    const g = await manage(c);
    if (g instanceof Response) return g;
    return c.json({ snapshots: await g.api.memorySnapshots() });
  });

  app.post("/api/persistent/:agentId/memory/rollback", async (c) => {
    const g = await manage(c);
    if (g instanceof Response) return g;
    const body = await jsonBody(c);
    if (typeof body.snapshotId !== "string" || !body.snapshotId) return c.json({ error: "INVALID", issues: ["snapshotId: required"] }, 400);
    const restored = await g.api.memoryRollback(body.snapshotId, g.actor);
    if (isError(restored)) return fail(c, restored.error);
    return c.json({ restored });
  });

  return app;
}
