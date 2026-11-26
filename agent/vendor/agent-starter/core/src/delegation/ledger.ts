/*
 * Durable delegation ledger over any SqlStore (Durable Object SQLite in production, node:sqlite in tests).
 *
 * The append-only event log written in the same transaction as the row, the per-run caps, the ancestor (ring) refusal,
 * "a result is delivered at most once" and the invariant checks are adapted from OpenMausBot's job runtime
 * (server/runtime/store.ts, runtime.ts, invariants.ts) at commit 542f8e55f3f9c5be5550aac0e99fcec050308d69
 * (https://github.com/milind-soni/openmausbot). Copyright 2026 Milind Soni and OpenMausBot contributors.
 * Licensed under the Apache License, Version 2.0 (see third_party/templates/openmausbot/LICENSE and NOTICE).
 *
 * MODIFIED for Agent Starter (Apache-2.0 section 4(b)): new SQL schema under its own migration namespace, one row per
 * side (requester "outgoing" / worker "incoming") because each agent is its own Durable Object, capability nonces,
 * task keys, tool grants and per-run USD budgets; wakes, rooms, restarts and approval levels removed.
 */
import { AgentError } from "../errors.ts";
import type { MigrationSet } from "../storage/migrations.ts";
import type { SqlStore } from "../storage/ports.ts";
import { randomId, randomToken, timingSafeEqual } from "../util/crypto.ts";
import {
  type Assignment,
  DEFAULT_DELEGATION_LIMITS,
  DELEGATION_TRANSITIONS,
  type DelegationLimits,
  type DelegationOrigin,
  type DelegationOutcome,
  type DelegationPlan,
  type DelegationRequest,
  type DelegationStatus,
  isTerminalDelegation,
} from "./types.ts";

export const DELEGATION_MIGRATIONS: MigrationSet = {
  namespace: "agent-starter-delegation",
  migrations: [
    {
      version: 1,
      name: "delegation-ledger",
      up: [
        `CREATE TABLE IF NOT EXISTS as_delegations (
          id TEXT NOT NULL,
          role TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          root_id TEXT NOT NULL,
          parent_id TEXT,
          depth INTEGER NOT NULL,
          chain_json TEXT NOT NULL,
          origin_json TEXT NOT NULL,
          requester_agent TEXT NOT NULL,
          requester_conversation TEXT NOT NULL,
          assignee_agent TEXT NOT NULL,
          assignee_conversation TEXT NOT NULL,
          mode TEXT NOT NULL,
          reply TEXT NOT NULL,
          task_key TEXT NOT NULL,
          brief TEXT NOT NULL,
          done_when TEXT,
          tool_grant_json TEXT NOT NULL,
          budget_usd REAL NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          outcome TEXT,
          result TEXT,
          nonce TEXT NOT NULL,
          guard_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          finished_at INTEGER,
          reported_at INTEGER,
          PRIMARY KEY (id, role)
        )`,
        `CREATE INDEX IF NOT EXISTS as_delegations_requester ON as_delegations(role, requester_conversation, status)`,
        `CREATE INDEX IF NOT EXISTS as_delegations_assignee ON as_delegations(role, assignee_conversation, status)`,
        `CREATE TABLE IF NOT EXISTS as_delegation_events (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          assignment_id TEXT NOT NULL,
          role TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT NOT NULL,
          detail TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS as_delegation_events_assignment ON as_delegation_events(assignment_id, role, seq)`,
      ],
      down: [`DROP TABLE IF EXISTS as_delegation_events`, `DROP TABLE IF EXISTS as_delegations`],
    },
  ],
};

type Row = {
  id: string;
  role: string;
  tenant_id: string;
  root_id: string;
  parent_id: string | null;
  depth: number;
  chain_json: string;
  origin_json: string;
  requester_agent: string;
  requester_conversation: string;
  assignee_agent: string;
  assignee_conversation: string;
  mode: string;
  reply: string;
  task_key: string;
  brief: string;
  done_when: string | null;
  tool_grant_json: string;
  budget_usd: number;
  cost_usd: number;
  status: string;
  outcome: string | null;
  result: string | null;
  nonce: string;
  guard_count: number;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
  reported_at: number | null;
};

function fromRow(row: Row): Assignment {
  return {
    id: row.id,
    role: row.role as Assignment["role"],
    tenantId: row.tenant_id,
    rootId: row.root_id,
    parentId: row.parent_id,
    depth: Number(row.depth),
    chain: JSON.parse(row.chain_json) as string[],
    origin: JSON.parse(row.origin_json) as DelegationOrigin,
    requester: { agent: row.requester_agent, conversationId: row.requester_conversation },
    assignee: { agent: row.assignee_agent, conversationId: row.assignee_conversation },
    mode: row.mode as Assignment["mode"],
    reply: row.reply as Assignment["reply"],
    taskKey: row.task_key,
    brief: row.brief,
    doneWhen: row.done_when,
    toolGrant: JSON.parse(row.tool_grant_json) as string[],
    budgetUsd: Number(row.budget_usd),
    costUsd: Number(row.cost_usd),
    status: row.status as DelegationStatus,
    outcome: row.outcome as DelegationOutcome | null,
    result: row.result,
    nonce: row.nonce,
    guardCount: Number(row.guard_count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    reportedAt: row.reported_at === null ? null : Number(row.reported_at),
  };
}

/** Grant = requester ∩ worker (∩ requested). Names outside the requester's grant are a refusal, never silently widened. */
export function computeToolGrant(requesterGrant: readonly string[], workerTools?: readonly string[], requested?: readonly string[]): { ok: true; grant: string[] } | { ok: false; outside: string[] } {
  const own = new Set(requesterGrant);
  if (requested) {
    const outside = requested.filter((name) => !own.has(name));
    if (outside.length) return { ok: false, outside };
  }
  let grant = [...own];
  if (workerTools) {
    const worker = new Set(workerTools);
    grant = grant.filter((name) => worker.has(name));
  }
  if (requested) {
    const narrow = new Set(requested);
    grant = grant.filter((name) => narrow.has(name));
  }
  return { ok: true, grant: grant.sort() };
}

/**
 * One delegation record per hand-off with an immutable origin, a status lifecycle validated against
 * `DELEGATION_TRANSITIONS`, and an append-only event per change (written in the same transaction).
 * The requester's Durable Object holds the "outgoing" row; the worker's holds the matching "incoming" row.
 */
export class DelegationLedger {
  readonly limits: DelegationLimits;

  constructor(
    private readonly sql: SqlStore,
    limits: Partial<DelegationLimits> = {},
    private readonly clock: () => number = Date.now,
  ) {
    this.limits = { ...DEFAULT_DELEGATION_LIMITS, ...limits };
  }

  get(id: string, role: Assignment["role"]): Assignment | null {
    const row = this.sql.exec<Row>(`SELECT * FROM as_delegations WHERE id = ? AND role = ?`, id, role)[0];
    return row ? fromRow(row) : null;
  }

  /** Outgoing assignments a requester conversation created, newest first. */
  outgoing(requesterConversationId: string, options: { openOnly?: boolean; limit?: number } = {}): Assignment[] {
    const rows = this.sql.exec<Row>(
      `SELECT * FROM as_delegations WHERE role = 'outgoing' AND requester_conversation = ? ${options.openOnly ? "AND status NOT IN ('completed','failed','cancelled')" : ""} ORDER BY created_at DESC, id DESC LIMIT ?`,
      requesterConversationId,
      options.limit ?? 50,
    );
    return rows.map(fromRow);
  }

  /** Incoming assignments for a worker conversation, newest first. */
  incoming(assigneeConversationId: string, options: { openOnly?: boolean; limit?: number } = {}): Assignment[] {
    const rows = this.sql.exec<Row>(
      `SELECT * FROM as_delegations WHERE role = 'incoming' AND assignee_conversation = ? ${options.openOnly ? "AND status NOT IN ('completed','failed','cancelled')" : ""} ORDER BY created_at DESC, id DESC LIMIT ?`,
      assigneeConversationId,
      options.limit ?? 50,
    );
    return rows.map(fromRow);
  }

  /** The assignment a worker conversation is currently working on (latest open incoming), if any. */
  activeIncoming(assigneeConversationId: string): Assignment | null {
    return this.incoming(assigneeConversationId, { openOnly: true, limit: 1 })[0] ?? null;
  }

  /**
   * Validate a delegation request against every guard and record it as an outgoing, queued assignment.
   * The same brief to the same worker and task key while still open is the same request (reused, not duplicated).
   */
  plan(request: DelegationRequest): DelegationPlan {
    const limits = this.limits;
    const parent = request.parent ?? null;
    const refuse = (refusal: Extract<DelegationPlan, { ok: false }>["refusal"], message: string): DelegationPlan => ({ ok: false, refusal, message });

    if (parent && parent.tenantId !== request.tenantId) return refuse("tenant", "The parent assignment belongs to another tenant.");
    if (request.assigneeAgent === request.requester.agent) return refuse("self", "An agent cannot delegate to itself; do the work directly.");
    const chain = parent ? [...parent.chain] : [request.requester.agent];
    if (chain[chain.length - 1] !== request.requester.agent) chain.push(request.requester.agent);
    if (chain.includes(request.assigneeAgent)) {
      return refuse("ring", `${request.assigneeAgent} is already part of this delegation chain (${chain.join(" → ")}); handing work back up the chain is refused. Finish your part and report instead.`);
    }
    const depth = (parent?.depth ?? 0) + 1;
    if (depth > limits.maxDepth) return refuse("depth", `Delegation depth ${depth} exceeds the limit of ${limits.maxDepth}. Do the remaining work yourself.`);

    const grant = computeToolGrant(request.requesterGrant, request.workerTools, request.requestedTools);
    if (!grant.ok) return refuse("grant", `You cannot grant tools you do not have: ${grant.outside.join(", ")}.`);

    const brief = request.brief.slice(0, limits.maxBriefChars);
    const existing = this.sql.exec<Row>(
      `SELECT * FROM as_delegations WHERE role = 'outgoing' AND requester_conversation = ? AND assignee_agent = ? AND task_key = ? AND brief = ? AND status NOT IN ('completed','failed','cancelled') LIMIT 1`,
      request.requester.conversationId,
      request.assigneeAgent,
      request.taskKey,
      brief,
    )[0];
    if (existing) return { ok: true, assignment: fromRow(existing), reused: true };

    const counts = this.sql.exec<{ total: number; open: number; reserved: number | null }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status NOT IN ('completed','failed','cancelled') THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status IN ('completed','failed','cancelled') THEN cost_usd ELSE MAX(budget_usd, cost_usd) END) AS reserved
       FROM as_delegations WHERE role = 'outgoing' AND requester_conversation = ?`,
      request.requester.conversationId,
    )[0] ?? { total: 0, open: 0, reserved: 0 };
    if (Number(counts.total) >= limits.maxPerRun) return refuse("per_run", `This conversation already delegated ${counts.total} tasks (limit ${limits.maxPerRun}).`);
    if (Number(counts.open ?? 0) >= limits.maxOpenPerRun) return refuse("open", `${counts.open} delegated tasks are still open (limit ${limits.maxOpenPerRun}); wait for results or check_delegation.`);
    const budgetUsd = Math.max(0, request.budgetUsd ?? limits.defaultBudgetUsd);
    const reserved = Number(counts.reserved ?? 0);
    if (reserved + budgetUsd > limits.maxBudgetUsdPerRun + 1e-9) {
      return refuse("budget", `The delegation budget for this conversation is exhausted ($${reserved.toFixed(4)} reserved of $${limits.maxBudgetUsdPerRun}).`);
    }

    const origin: DelegationOrigin = parent
      ? parent.origin
      : { agent: request.origin?.agent ?? request.requester.agent, conversationId: request.origin?.conversationId ?? request.requester.conversationId, tenantId: request.tenantId, kind: request.origin?.kind ?? "outside", ...(request.origin?.userId ? { userId: request.origin.userId } : {}) };
    const id = randomId("dlg");
    const now = this.clock();
    const mode = request.mode;
    const assignment: Assignment = {
      id,
      role: "outgoing",
      tenantId: request.tenantId,
      rootId: parent?.rootId ?? id,
      parentId: parent?.id ?? null,
      depth,
      chain: [...chain, request.assigneeAgent],
      origin,
      requester: { ...request.requester },
      assignee: { agent: request.assigneeAgent, conversationId: request.assigneeConversationId },
      mode,
      reply: mode === "notify" ? "none" : (request.reply ?? "resume"),
      taskKey: request.taskKey,
      brief,
      doneWhen: request.doneWhen?.slice(0, 1000) ?? null,
      toolGrant: mode === "notify" ? [] : grant.grant,
      budgetUsd,
      costUsd: 0,
      status: "queued",
      outcome: null,
      result: null,
      nonce: randomToken(16),
      guardCount: 0,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      reportedAt: null,
    };
    this.sql.transaction(() => {
      this.insert(assignment);
      this.event(id, "outgoing", null, "queued", `to ${request.assigneeAgent} (${mode}/${assignment.reply})`);
    });
    return { ok: true, assignment, reused: false };
  }

  /**
   * Record an assignment on the worker side (idempotent per id). The worker's tenant must match;
   * the grant is narrowed again to the worker's own tools so a forged delivery can only restrict, never widen.
   */
  receive(assignment: Omit<Assignment, "role" | "status" | "outcome" | "result" | "guardCount" | "updatedAt" | "finishedAt" | "reportedAt" | "costUsd">, context: { tenantId: string; workerTools?: readonly string[] }): { assignment: Assignment; created: boolean } {
    if (assignment.tenantId !== context.tenantId || assignment.origin.tenantId !== context.tenantId) {
      throw new AgentError("TENANT_ISOLATION_VIOLATION", "Delegated assignment belongs to another tenant.");
    }
    const existing = this.get(assignment.id, "incoming");
    if (existing) return { assignment: existing, created: false };
    const grant = context.workerTools ? assignment.toolGrant.filter((name) => context.workerTools?.includes(name)) : assignment.toolGrant;
    const now = this.clock();
    const row: Assignment = { ...assignment, role: "incoming", toolGrant: [...grant].sort(), status: "running", outcome: null, result: null, guardCount: 0, costUsd: 0, updatedAt: now, finishedAt: null, reportedAt: null };
    this.sql.transaction(() => {
      this.insert(row);
      this.event(row.id, "incoming", null, "running", `from ${row.requester.agent}`);
    });
    return { assignment: row, created: true };
  }

  /** Validated status change (terminal rows never change; illegal transitions throw). */
  transition(id: string, role: Assignment["role"], to: DelegationStatus, patch: { outcome?: DelegationOutcome; result?: string; costUsd?: number; detail?: string } = {}): Assignment {
    const current = this.get(id, role);
    if (!current) throw new AgentError("INVALID_STATE_TRANSITION", `Unknown ${role} assignment ${id}`);
    if (current.status === to && !isTerminalDelegation(to)) return current;
    if (!DELEGATION_TRANSITIONS[current.status].includes(to)) {
      throw new AgentError("INVALID_STATE_TRANSITION", `Assignment ${id} cannot go from ${current.status} to ${to}.`);
    }
    const now = this.clock();
    const terminal = isTerminalDelegation(to);
    this.sql.transaction(() => {
      this.sql.exec(
        `UPDATE as_delegations SET status = ?, outcome = COALESCE(?, outcome), result = COALESCE(?, result), cost_usd = MAX(cost_usd, COALESCE(?, cost_usd)), updated_at = ?, finished_at = ? WHERE id = ? AND role = ?`,
        to,
        patch.outcome ?? null,
        patch.result === undefined ? null : patch.result.slice(0, 12_000),
        patch.costUsd ?? null,
        now,
        terminal ? now : null,
        id,
        role,
      );
      this.event(id, role, current.status, to, patch.detail ?? patch.outcome ?? null);
    });
    return this.get(id, role) as Assignment;
  }

  /** Settle a row once: a second settlement of a terminal row is a no-op (`changed: false`), so no result is applied twice. */
  settle(id: string, role: Assignment["role"], result: { status: Extract<DelegationStatus, "completed" | "failed" | "cancelled" | "needs_input">; outcome: DelegationOutcome; result?: string; costUsd?: number }): { assignment: Assignment; changed: boolean } {
    const current = this.get(id, role);
    if (!current) throw new AgentError("INVALID_STATE_TRANSITION", `Unknown ${role} assignment ${id}`);
    if (isTerminalDelegation(current.status) || (current.status === result.status && result.status === "needs_input")) return { assignment: current, changed: false };
    // A queued outgoing row whose result arrives skips straight through running.
    if (current.status === "queued" && result.status !== "cancelled") this.transition(id, role, "running", { detail: "result arrived" });
    const settled = this.transition(id, role, result.status, { outcome: result.outcome, ...(result.result !== undefined ? { result: result.result } : {}), ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}) });
    return { assignment: settled, changed: true };
  }

  /**
   * Requester side: accept a worker's result only when it echoes the assignment's capability nonce.
   * Returns `changed: false` for a duplicate delivery.
   */
  acceptResult(id: string, nonce: string, result: { status: "completed" | "failed" | "needs_input"; outcome: DelegationOutcome; result: string; costUsd?: number }): { ok: true; assignment: Assignment; changed: boolean } | { ok: false; reason: string } {
    const current = this.get(id, "outgoing");
    if (!current) return { ok: false, reason: "unknown assignment" };
    if (!timingSafeEqual(current.nonce, nonce)) return { ok: false, reason: "nonce mismatch" };
    const settled = this.settle(id, "outgoing", result);
    if (settled.changed) this.markReported(id, "outgoing");
    return { ok: true, assignment: this.get(id, "outgoing") as Assignment, changed: settled.changed };
  }

  markReported(id: string, role: Assignment["role"]): void {
    this.sql.exec(`UPDATE as_delegations SET reported_at = COALESCE(reported_at, ?) WHERE id = ? AND role = ?`, this.clock(), id, role);
  }

  /** Reply guard: count a worker turn that ended without a report. Returns the new count. */
  bumpGuard(id: string, role: Assignment["role"]): number {
    this.sql.exec(`UPDATE as_delegations SET guard_count = guard_count + 1, updated_at = ? WHERE id = ? AND role = ?`, this.clock(), id, role);
    return this.get(id, role)?.guardCount ?? 0;
  }

  events(id: string, role: Assignment["role"]): Array<{ seq: number; from: string | null; to: string; detail: string | null; at: number }> {
    return this.sql
      .exec<{ seq: number; from_status: string | null; to_status: string; detail: string | null; created_at: number }>(`SELECT seq, from_status, to_status, detail, created_at FROM as_delegation_events WHERE assignment_id = ? AND role = ? ORDER BY seq`, id, role)
      .map((e) => ({ seq: Number(e.seq), from: e.from_status, to: e.to_status, detail: e.detail, at: Number(e.created_at) }));
  }

  /**
   * Invariants asserted by tests after every scenario (empty array = healthy):
   *  I1 terminal ⇔ finished_at set;  I2 depth = chain length − 1 ≤ maxDepth;  I3 no agent twice in a chain (ring-free);
   *  I4 the row can be rebuilt from its events (last event = status, every step legal);  I5 at most one terminal event
   *  per row (no result applied twice);  I6 reported only once settled;  I7 a child keeps its parent's origin and tenant
   *  and sits one level deeper (checked when both sides share a store, e.g. tests);  I8 notify never grants tools.
   */
  invariants(): string[] {
    const violations: string[] = [];
    const rows = this.sql.exec<Row>(`SELECT * FROM as_delegations`).map(fromRow);
    const byKey = new Map(rows.map((r) => [`${r.id}:${r.role}`, r]));
    for (const a of rows) {
      const key = `${a.role} ${a.id}`;
      const terminal = isTerminalDelegation(a.status);
      if (terminal !== (a.finishedAt !== null)) violations.push(`I1 ${key}: status ${a.status} with finishedAt ${a.finishedAt}`);
      if (a.depth !== a.chain.length - 1 || a.depth > this.limits.maxDepth || a.depth < 1) violations.push(`I2 ${key}: depth ${a.depth} vs chain ${a.chain.join(">")}`);
      if (new Set(a.chain).size !== a.chain.length) violations.push(`I3 ${key}: ring in chain ${a.chain.join(">")}`);
      const events = this.events(a.id, a.role);
      if (events.length === 0 || events[events.length - 1]?.to !== a.status) violations.push(`I4 ${key}: last event ${events[events.length - 1]?.to} ≠ status ${a.status}`);
      for (const e of events) {
        if (e.from !== null && !DELEGATION_TRANSITIONS[e.from as DelegationStatus]?.includes(e.to as DelegationStatus)) violations.push(`I4 ${key}: illegal step ${e.from}→${e.to}`);
      }
      if (events.filter((e) => isTerminalDelegation(e.to as DelegationStatus)).length > 1) violations.push(`I5 ${key}: settled more than once`);
      if (a.reportedAt !== null && !terminal && a.status !== "needs_input") violations.push(`I6 ${key}: reported while ${a.status}`);
      if (a.parentId) {
        const parent = byKey.get(`${a.parentId}:incoming`);
        if (parent) {
          if (JSON.stringify(parent.origin) !== JSON.stringify(a.origin)) violations.push(`I7 ${key}: origin differs from parent`);
          if (parent.tenantId !== a.tenantId) violations.push(`I7 ${key}: tenant differs from parent`);
          if (parent.depth + 1 !== a.depth) violations.push(`I7 ${key}: depth ${a.depth} under parent depth ${parent.depth}`);
        }
      }
      if (a.mode === "notify" && a.toolGrant.length > 0) violations.push(`I8 ${key}: notify with a tool grant`);
    }
    return violations;
  }

  private insert(a: Assignment): void {
    this.sql.exec(
      `INSERT INTO as_delegations (id, role, tenant_id, root_id, parent_id, depth, chain_json, origin_json, requester_agent, requester_conversation, assignee_agent, assignee_conversation, mode, reply, task_key, brief, done_when, tool_grant_json, budget_usd, cost_usd, status, outcome, result, nonce, guard_count, created_at, updated_at, finished_at, reported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id,
      a.role,
      a.tenantId,
      a.rootId,
      a.parentId,
      a.depth,
      JSON.stringify(a.chain),
      JSON.stringify(a.origin),
      a.requester.agent,
      a.requester.conversationId,
      a.assignee.agent,
      a.assignee.conversationId,
      a.mode,
      a.reply,
      a.taskKey,
      a.brief,
      a.doneWhen,
      JSON.stringify(a.toolGrant),
      a.budgetUsd,
      a.costUsd,
      a.status,
      a.outcome,
      a.result,
      a.nonce,
      a.guardCount,
      a.createdAt,
      a.updatedAt,
      a.finishedAt,
      a.reportedAt,
    );
  }

  private event(id: string, role: Assignment["role"], from: DelegationStatus | null, to: DelegationStatus, detail: string | null): void {
    this.sql.exec(`INSERT INTO as_delegation_events (assignment_id, role, from_status, to_status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`, id, role, from, to, detail, this.clock());
  }
}
