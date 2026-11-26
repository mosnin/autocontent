import { CORE_MIGRATIONS, type EfficiencyReport, type MigrationSet, MigrationRunner, type ModelProvider, type RunRecord, RunStore, type SqlStore, type TelemetryEvent, type TelemetrySink } from "@agent-starter/core";
import type { RunStatus } from "@agent-starter/core";
import { DurableObject } from "cloudflare:workers";
import type { ConfigProposal, MemoryEntry, MemoryWriteInput, PersistentAgentConfig, PersistentTrigger, TurnSummary } from "@agent-starter/core";
import { DurableObjectSqlStore } from "./adapters.ts";
import { type AuditEntry, type ControlActor, type ControlErrorShape, PersistentControlEngine, type PersistentControlState, type PersistentStatus, type PutConfigResult, toControlErrorShape } from "./persistent-control.ts";
import { ROOM_MIGRATIONS, type RoomConfig, RoomEngine, type RoomMessage, type RoomOutcome, type RoomParticipant, type RoomSummonContext } from "./room-engine.ts";

/**
 * Close codes a server may not echo back: 1005 (no status) and 1006 (abnormal closure) are reserved for the local
 * endpoint and make `ws.close()` throw; 1015 (TLS) likewise. Map them to 1000 (normal) / 1011 (unexpected condition).
 */
export function safeCloseCode(code: number): number {
  if (code === 1006 || code === 1015) return 1011;
  if (code === 1005 || code === 1004 || !Number.isInteger(code) || code < 1000 || code > 4999 || (code > 1015 && code < 3000)) return 1000;
  return code;
}

/**
 * Group-chat coordinator Durable Object. Subclass it in your Worker and implement `summon()` to dispatch a turn to the
 * participant agent (e.g. `dispatch(AnalystAgent, { id, message })` for Flue agents) and, optionally, `onSettled()` to
 * report the outcome back to whoever opened the room. Browsers connect via WebSocket (hibernation API) to watch the
 * swarm live; every turn is also fanned out to optional telemetry sinks (webhook relay, Pusher).
 *
 *   wrangler: durable_objects.bindings += { name: "GROUP_CHAT_ROOM", class_name: "MyRoom" }
 *             migrations += { tag: "vN", new_sqlite_classes: ["MyRoom"] }
 */
export abstract class AgentGroupChatRoom<Env = unknown> extends DurableObject<Env> {
  protected readonly engine: RoomEngine;
  protected readonly store: DurableObjectSqlStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = DurableObjectSqlStore.fromState(ctx);
    new MigrationRunner(this.store).migrateUp(ROOM_MIGRATIONS);
    const moderator = this.moderator();
    const decider = this.decider();
    this.engine = new RoomEngine(
      this.store,
      {
        summon: (participant, transcript, config, context) => this.summon(participant, transcript, config, context),
        broadcast: (event) => this.broadcast(event),
        scheduleTimeout: (at) => this.scheduleAlarm(at),
        onSettled: (outcome) => this.onSettled(outcome),
      },
      { ...(moderator ? { moderator } : {}), ...(decider ? { decider } : {}) },
    );
  }

  /**
   * Dispatch a turn to the participant. Must return quickly (fire-and-forget); the participant posts back via `post()`.
   * Use `context.seq` (monotonic) in the idempotency key and render `context.batch` (what it missed).
   */
  protected abstract summon(participant: RoomParticipant, transcript: RoomMessage[], config: RoomConfig, context: RoomSummonContext): Promise<void>;

  /** Cheap moderator model (Workers AI) answering "NEXT:"/"HALT:". Return undefined for round-robin turn-taking. */
  protected moderator(): ModelProvider | undefined {
    return undefined;
  }

  /** Fast decider (JSON speaker + confidence, 0.6 threshold, falls back to the lead). Takes precedence over `moderator()`. */
  protected decider(): ModelProvider | undefined {
    return undefined;
  }

  /**
   * Completion hook (R-MA-08): called once the room is COMPLETED or HALTED, retried from the alarm until it succeeds.
   * Override it to dispatch a `room-result` signal to `outcome.requester.conversationId` with an idempotency key
   * such as `room-result:<roomId>` so retries converge on one delivery.
   */
  protected async onSettled(_outcome: RoomOutcome): Promise<void> {}

  /** Extra sinks (WebhookRelay, PusherPublisher...). */
  protected sinks(): TelemetrySink[] {
    return [];
  }

  /** Keep the earliest wake-up; a stored alarm that is already due (or firing) does not block a new one. */
  private async scheduleAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current <= Date.now()) await this.ctx.storage.setAlarm(at);
  }

  // ---- RPC surface -------------------------------------------------------
  /** Idempotent: re-opening a configured room (a retried tool call) does not post the kickoff twice. */
  async open(config: RoomConfig, kickoff: { senderId: string; senderRole: string; content: string }): Promise<{ roomId: string }> {
    if (this.engine.config()) return { roomId: this.engine.config()?.roomId ?? config.roomId };
    this.engine.configure(config);
    await this.engine.post(kickoff);
    return { roomId: config.roomId };
  }

  async post(message: { senderId: string; senderRole: string; content: string; costUsd?: number }) {
    return this.engine.post(message);
  }

  /** Spend a participant reports outside a post (idempotent per key; trips the budget ceiling). */
  async recordCost(entry: { key: string; participantId: string; costUsd: number }) {
    return this.engine.recordCost(entry);
  }

  async getState(): Promise<{ status: string; config: RoomConfig | null; transcript: RoomMessage[]; stats: { turns: number; costUsd: number }; pending: string[] }> {
    return { status: this.engine.status(), config: this.engine.config(), transcript: this.engine.transcript(200), stats: this.engine.stats(), pending: this.engine.pending() };
  }

  /**
   * Who may observe the room (SEC-18): its tenant and the conversation that opened it. Routes check this (owner of
   * `requester.conversationId`, or an admin) before serving state or the live feed. Null while unconfigured.
   */
  async describe(): Promise<{ roomId: string; tenantId: string; requester: RoomConfig["requester"] | null; status: string } | null> {
    const config = this.engine.config();
    return config ? { roomId: config.roomId, tenantId: config.tenantId, requester: config.requester ?? null, status: this.engine.status() } : null;
  }

  /**
   * Remind/skip overdue speakers, retry an undelivered outcome, then re-arm for the next pending deadline or retry.
   * The alarm is re-armed here explicitly because `scheduleAlarm` keeps only the earliest time: without it a later
   * speaker's deadline (summoned while an earlier alarm was set) would never fire.
   */
  override async alarm(): Promise<void> {
    const next = await this.engine.onAlarm();
    if (next !== null) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1_000));
  }

  // ---- Live UI over hibernatable WebSockets --------------------------------
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(await this.getState());
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    // History as real TelemetryEvents (stable ids, so they dedupe against live broadcasts in useAgentTelemetry).
    server.send(JSON.stringify({ type: "history", events: this.engine.historyEvents(50) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") ws.send("pong");
  }

  override async webSocketClose(ws: WebSocket, code: number, reason?: string): Promise<void> {
    try {
      ws.close(safeCloseCode(code), (reason ?? "closing").slice(0, 120));
    } catch {
      // Already closed.
    }
  }

  /**
   * Live sockets get the event inline; sinks (WebhookRelay with retries and timeouts, Pusher) run after the
   * turn through `ctx.waitUntil`, so a slow SaaS endpoint never blocks the room (spec L808/L902, non-blocking relay).
   */
  protected async broadcast(event: TelemetryEvent): Promise<void> {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // Socket already gone; hibernation API cleans it up.
      }
    }
    const sinks = this.sinks();
    if (sinks.length === 0) return;
    const relayed = Promise.allSettled(sinks.map(async (sink) => sink.publish(event))).then(() => undefined);
    try {
      this.ctx.waitUntil(relayed);
    } catch {
      // No waitUntil on this state (tests): finish inline.
      await relayed;
    }
  }
}

/**
 * Counters an agent run reports with every heartbeat. All are cumulative for the run (a snapshot, not a delta);
 * the registry keeps the highest value it has seen, so late or out-of-order beats never lower a counter. Report
 * conversation-cumulative values (not per-submission or per-budget-scope ones): the efficiency report derives each
 * window's spend from the difference between snapshots.
 */
export interface RunCounters {
  turnCount?: number;
  costUsd?: number;
  tokens?: number;
  toolCalls?: number;
  /** VM runtime, when the run used computer-use VMs. */
  vmSeconds?: number;
  vmCostUsd?: number;
  /** Part of the VM cost from VMs that ran until the provider's hard TTL instead of being stopped (leaked compute). */
  vmLeakedCostUsd?: number;
  /** Model routing decisions by tier, when the run reports them. */
  routing?: { firstLine?: number; frontier?: number };
}

/** Width of the per-run counter snapshots the efficiency report diffs (window edges are accurate to one bucket). */
export const RUN_COUNTER_BUCKET_MS = 15 * 60_000;
/** Settled runs (IDLE, COMPLETED, FAILED, HALTED, TERMINATED) without a beat for this long are pruned. */
export const REGISTRY_RETENTION_MS = 30 * 86_400_000;
const SETTLED_STATUSES = `('IDLE', 'COMPLETED', 'FAILED', 'HALTED', 'TERMINATED')`;

export const REGISTRY_MIGRATIONS: MigrationSet = {
  namespace: "agent-starter-registry",
  migrations: [
    {
      version: 1,
      name: "run-counters",
      up: [
        `CREATE TABLE IF NOT EXISTS as_run_counters (
          run_id TEXT PRIMARY KEY,
          tokens INTEGER NOT NULL DEFAULT 0,
          tool_calls INTEGER NOT NULL DEFAULT 0,
          vm_seconds REAL NOT NULL DEFAULT 0,
          vm_cost_usd REAL NOT NULL DEFAULT 0,
          first_line_routes INTEGER NOT NULL DEFAULT 0,
          frontier_routes INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )`,
      ],
      down: [`DROP TABLE IF EXISTS as_run_counters`],
    },
    {
      version: 2,
      name: "counter-buckets-leaked-cost-recoveries",
      up: [
        `ALTER TABLE as_run_counters ADD COLUMN vm_leaked_cost_usd REAL NOT NULL DEFAULT 0`,
        `CREATE TABLE IF NOT EXISTS as_run_counter_buckets (
          run_id TEXT NOT NULL,
          bucket INTEGER NOT NULL,
          turn_count INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          tokens INTEGER NOT NULL DEFAULT 0,
          tool_calls INTEGER NOT NULL DEFAULT 0,
          vm_seconds REAL NOT NULL DEFAULT 0,
          vm_cost_usd REAL NOT NULL DEFAULT 0,
          vm_leaked_cost_usd REAL NOT NULL DEFAULT 0,
          first_line_routes INTEGER NOT NULL DEFAULT 0,
          frontier_routes INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (run_id, bucket)
        )`,
        `CREATE INDEX IF NOT EXISTS as_run_counter_buckets_bucket ON as_run_counter_buckets(bucket)`,
        `CREATE TABLE IF NOT EXISTS as_run_recoveries (run_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
      ],
      down: [`DROP TABLE IF EXISTS as_run_recoveries`, `DROP TABLE IF EXISTS as_run_counter_buckets`],
    },
  ],
};

const COUNTER_COLUMNS = ["turn_count", "cost_usd", "tokens", "tool_calls", "vm_seconds", "vm_cost_usd", "vm_leaked_cost_usd", "first_line_routes", "frontier_routes"] as const;
type CounterColumn = (typeof COUNTER_COLUMNS)[number];

/**
 * Record a run's counters (monotonic max) into `as_runs` + `as_run_counters`, plus a snapshot of the run's cumulative
 * counters in the current `RUN_COUNTER_BUCKET_MS` bucket (what `aggregateRunReport` diffs per window).
 */
export function recordRunCounters(sql: SqlStore, runs: RunStore, runId: string, counters: RunCounters | undefined, now = Date.now()): void {
  const current = runs.get(runId);
  if (!counters) {
    runs.heartbeat(runId);
    return;
  }
  const max = (a: number | undefined, b: number | undefined) => (b === undefined ? undefined : Math.max(a ?? 0, b));
  runs.heartbeat(runId, {
    ...(counters.turnCount !== undefined ? { turnCount: max(current?.turnCount, counters.turnCount) as number } : {}),
    ...(counters.costUsd !== undefined ? { costUsd: max(current?.costUsd, counters.costUsd) as number } : {}),
  });
  const extra = [counters.tokens, counters.toolCalls, counters.vmSeconds, counters.vmCostUsd, counters.vmLeakedCostUsd, counters.routing?.firstLine, counters.routing?.frontier];
  if (extra.some((v) => v !== undefined)) {
    sql.exec(
      `INSERT INTO as_run_counters (run_id, tokens, tool_calls, vm_seconds, vm_cost_usd, vm_leaked_cost_usd, first_line_routes, frontier_routes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET tokens = MAX(as_run_counters.tokens, excluded.tokens), tool_calls = MAX(as_run_counters.tool_calls, excluded.tool_calls),
         vm_seconds = MAX(as_run_counters.vm_seconds, excluded.vm_seconds), vm_cost_usd = MAX(as_run_counters.vm_cost_usd, excluded.vm_cost_usd),
         vm_leaked_cost_usd = MAX(as_run_counters.vm_leaked_cost_usd, excluded.vm_leaked_cost_usd),
         first_line_routes = MAX(as_run_counters.first_line_routes, excluded.first_line_routes), frontier_routes = MAX(as_run_counters.frontier_routes, excluded.frontier_routes),
         updated_at = excluded.updated_at`,
      runId,
      counters.tokens ?? 0,
      counters.toolCalls ?? 0,
      counters.vmSeconds ?? 0,
      counters.vmCostUsd ?? 0,
      counters.vmLeakedCostUsd ?? 0,
      counters.routing?.firstLine ?? 0,
      counters.routing?.frontier ?? 0,
      now,
    );
  }
  // Snapshot of the run's cumulative counters in this bucket (max wins, like the counters themselves).
  sql.exec(
    `INSERT INTO as_run_counter_buckets (run_id, bucket, ${COUNTER_COLUMNS.join(", ")})
     SELECT r.run_id, ?, r.turn_count, r.cost_usd, COALESCE(c.tokens, 0), COALESCE(c.tool_calls, 0), COALESCE(c.vm_seconds, 0), COALESCE(c.vm_cost_usd, 0),
            COALESCE(c.vm_leaked_cost_usd, 0), COALESCE(c.first_line_routes, 0), COALESCE(c.frontier_routes, 0)
     FROM as_runs r LEFT JOIN as_run_counters c ON c.run_id = r.run_id WHERE r.run_id = ?
     ON CONFLICT(run_id, bucket) DO UPDATE SET ${COUNTER_COLUMNS.map((col) => `${col} = MAX(as_run_counter_buckets.${col}, excluded.${col})`).join(", ")}`,
    Math.floor(now / RUN_COUNTER_BUCKET_MS),
    runId,
  );
}

export type RegistryEfficiencyReport = EfficiencyReport & {
  kpis: EfficiencyReport["kpis"] & {
    /** Cost from VMs that ran until the provider's hard TTL ceiling (leaked compute), in this window. Part of the VM cost. */
    infrastructureLeakedCostUsd: number;
  };
  totals: { turns: number; tokens: number; toolCalls: number; vmCostUsd: number; vmLeakedCostUsd: number; firstLineRoutes: number; frontierRoutes: number };
};

type WindowRow = { run_id: string; tenant_id: string; status: string; last_heartbeat_at: number; has_buckets: number } & { [K in CounterColumn as `c_${K}`]: number | null } & { [K in CounterColumn as `e_${K}`]: number | null } & {
  [K in CounterColumn as `s_${K}`]: number | null;
};

/**
 * Efficiency report aggregated from what agents reported into the registry (heartbeat counters + `complete()`),
 * never from ledgers in the registry's own SQLite (those live in each agent's Durable Object). A run is in the window
 * when it was active during it (created before `to`, last heartbeat after `from`). Its contribution is what it spent
 * INSIDE the window: the cumulative snapshot at the window's end minus the one before its start (bucketed by
 * `RUN_COUNTER_BUCKET_MS`), so a long-lived conversation is not re-counted every day. Runs that never reported a
 * snapshot (rows from before snapshots existed) fall back to their cumulative counters. Anomalies use the same
 * window values.
 */
export function aggregateRunReport(sql: SqlStore, window: { from: number; to: number }, thresholds: { maxTurns: number; maxCostUsd: number; stallMs?: number } = { maxTurns: 25, maxCostUsd: 1.5, stallMs: 180_000 }, now = Date.now()): RegistryEfficiencyReport {
  const pick = (alias: string, prefix: string) => COUNTER_COLUMNS.map((col) => `${alias}.${col} AS ${prefix}_${col}`).join(", ");
  const maxes = COUNTER_COLUMNS.map((col) => `MAX(${col}) AS ${col}`).join(", ");
  const runs = sql.exec<WindowRow>(
    `SELECT r.run_id, r.tenant_id, r.status, r.last_heartbeat_at,
            r.turn_count AS c_turn_count, r.cost_usd AS c_cost_usd, c.tokens AS c_tokens, c.tool_calls AS c_tool_calls, c.vm_seconds AS c_vm_seconds, c.vm_cost_usd AS c_vm_cost_usd,
            c.vm_leaked_cost_usd AS c_vm_leaked_cost_usd, c.first_line_routes AS c_first_line_routes, c.frontier_routes AS c_frontier_routes,
            ${pick("e", "e")}, ${pick("s", "s")},
            EXISTS (SELECT 1 FROM as_run_counter_buckets b WHERE b.run_id = r.run_id) AS has_buckets
     FROM as_runs r
     LEFT JOIN as_run_counters c ON c.run_id = r.run_id
     LEFT JOIN (SELECT run_id, ${maxes} FROM as_run_counter_buckets WHERE bucket <= ? GROUP BY run_id) e ON e.run_id = r.run_id
     LEFT JOIN (SELECT run_id, ${maxes} FROM as_run_counter_buckets WHERE bucket < ? GROUP BY run_id) s ON s.run_id = r.run_id
     WHERE r.created_at <= ? AND r.last_heartbeat_at >= ?`,
    Math.floor(window.to / RUN_COUNTER_BUCKET_MS),
    Math.floor(window.from / RUN_COUNTER_BUCKET_MS),
    window.to,
    window.from,
  );
  const inWindow = (run: WindowRow, col: CounterColumn): number => {
    if (!Number(run.has_buckets)) return Number(run[`c_${col}`] ?? 0);
    return Math.max(0, Number(run[`e_${col}`] ?? 0) - Number(run[`s_${col}`] ?? 0));
  };
  const sum: Record<CounterColumn, number> = Object.fromEntries(COUNTER_COLUMNS.map((col) => [col, 0])) as Record<CounterColumn, number>;
  let vmRuns = 0;
  const anomalies: EfficiencyReport["anomalies"] = [];
  for (const run of runs) {
    const values = Object.fromEntries(COUNTER_COLUMNS.map((col) => [col, inWindow(run, col)])) as Record<CounterColumn, number>;
    for (const col of COUNTER_COLUMNS) sum[col] += values[col];
    if (values.vm_seconds > 0) vmRuns += 1;
    const runCost = Number(values.cost_usd.toFixed(6));
    const runTurns = values.turn_count;
    if (runCost >= thresholds.maxCostUsd) anomalies.push({ runId: run.run_id, tenantId: run.tenant_id, issue: "BUDGET_LIMIT_BREACHED", accumulatedCostUsd: runCost, turnCount: runTurns });
    else if (runTurns >= thresholds.maxTurns) anomalies.push({ runId: run.run_id, tenantId: run.tenant_id, issue: "ROGUE_LOOP_DETECTED", accumulatedCostUsd: runCost, turnCount: runTurns });
    else if (thresholds.stallMs && (run.status === "RUNNING" || run.status === "PROVISIONING") && now - Number(run.last_heartbeat_at) > thresholds.stallMs) {
      anomalies.push({ runId: run.run_id, tenantId: run.tenant_id, issue: "STALLED", accumulatedCostUsd: runCost, turnCount: runTurns });
    }
  }
  const jobs = runs.length;
  const cost = sum.cost_usd;
  const routes = sum.first_line_routes + sum.frontier_routes;
  return {
    window,
    summary: { totalJobs: jobs, totalExecutionCostUsd: Number(cost.toFixed(6)), averageJobCostUsd: jobs ? Number((cost / jobs).toFixed(6)) : 0, totalVmSeconds: sum.vm_seconds },
    kpis: {
      firstLineRoutingDensity: routes ? sum.first_line_routes / routes : 0,
      averageTurnsPerJob: jobs ? sum.turn_count / jobs : 0,
      averageVmRunSeconds: vmRuns ? sum.vm_seconds / vmRuns : 0,
      tokensPerDollar: cost > 0 ? sum.tokens / cost : 0,
      infrastructureLeakedCostUsd: Number(sum.vm_leaked_cost_usd.toFixed(6)),
    },
    anomalies,
    totals: {
      turns: sum.turn_count,
      tokens: sum.tokens,
      toolCalls: sum.tool_calls,
      vmCostUsd: Number(sum.vm_cost_usd.toFixed(6)),
      vmLeakedCostUsd: Number(sum.vm_leaked_cost_usd.toFixed(6)),
      firstLineRoutes: sum.first_line_routes,
      frontierRoutes: sum.frontier_routes,
    },
  };
}

/**
 * Retention for the registry: deletes settled runs (IDLE, COMPLETED, FAILED, HALTED, TERMINATED) whose last beat is
 * older than `retentionMs`, with their counters, snapshots and recovery counts, and trims snapshots older than
 * `retentionMs` for live runs (keeping each run's latest one as the baseline for the next report window).
 * Note: a conversation pruned after a long silence that later resumes reports its lifetime counters once.
 */
export function pruneRegistry(sql: SqlStore, options: { retentionMs?: number; now?: number } = {}): { runs: number } {
  const cutoff = (options.now ?? Date.now()) - (options.retentionMs ?? REGISTRY_RETENTION_MS);
  const stale = `SELECT run_id FROM as_runs WHERE status IN ${SETTLED_STATUSES} AND last_heartbeat_at < ?`;
  const runs = Number(sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM (${stale})`, cutoff)[0]?.n ?? 0);
  sql.transaction(() => {
    for (const table of ["as_run_counters", "as_run_counter_buckets", "as_run_recoveries"]) sql.exec(`DELETE FROM ${table} WHERE run_id IN (${stale})`, cutoff);
    sql.exec(`DELETE FROM as_runs WHERE status IN ${SETTLED_STATUSES} AND last_heartbeat_at < ?`, cutoff);
    sql.exec(
      `DELETE FROM as_run_counter_buckets WHERE bucket < ? AND (run_id, bucket) NOT IN (SELECT run_id, MAX(bucket) FROM as_run_counter_buckets GROUP BY run_id)`,
      Math.floor(cutoff / RUN_COUNTER_BUCKET_MS),
    );
  });
  return { runs };
}

/**
 * Client-side guard for registry beats (R16): the registry is one Durable Object on the hot path of every tool call,
 * so a beat must never add its latency to the agent. The returned function throttles beats per run
 * (`minIntervalMs`, default 5 s; a beat whose counters changed is still throttled — the settle-time `complete()`
 * carries the final counters), gives up waiting after `timeoutMs` (default 500 ms; the RPC itself keeps going), and
 * never throws. Call it without awaiting (`void beat(...)` or `ctx.waitUntil(beat(...))`).
 */
export function createRegistryBeat<C = RunCounters>(
  registry: () => { beat(run: { runId: string; tenantId: string; agent: string }, counters?: C): Promise<unknown> },
  options: { timeoutMs?: number; minIntervalMs?: number; clock?: () => number; maxTracked?: number; onError?: (error: unknown) => void } = {},
): (run: { runId: string; tenantId: string; agent: string }, counters?: C) => Promise<void> {
  const last = new Map<string, number>();
  const clock = options.clock ?? Date.now;
  const interval = options.minIntervalMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 500;
  const maxTracked = options.maxTracked ?? 10_000;
  return async (run, counters) => {
    const now = clock();
    if (now - (last.get(run.runId) ?? Number.NEGATIVE_INFINITY) < interval) return;
    last.delete(run.runId);
    last.set(run.runId, now);
    if (last.size > maxTracked) last.delete(last.keys().next().value as string);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => registry().beat(run, counters)),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } catch (error) {
      options.onError?.(error);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Global run registry (liveness ledger) for the out-of-band heartbeat sentinel. Agents call `register` / `beat` /
 * `complete`; the cron sentinel calls `stalled()` every minute (which also prunes old settled runs about once an
 * hour, see `pruneRegistry`); the daily report calls `efficiencyReport()`. Recovery attempts are counted here
 * (`noteRecovery`) and reset when a submission settles cleanly (`complete(runId, "COMPLETED")`), so a long-lived
 * conversation with a few unrelated stalls is never failed for good. Use one instance (`getByName("global")`) or
 * shard per tenant for very large fleets.
 */
export class RunRegistry<Env = unknown> extends DurableObject<Env> {
  private readonly runs: RunStore;
  private readonly store: DurableObjectSqlStore;
  private lastPruneAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = DurableObjectSqlStore.fromState(ctx);
    const migrations = new MigrationRunner(this.store);
    migrations.migrateUp(CORE_MIGRATIONS);
    migrations.migrateUp(REGISTRY_MIGRATIONS);
    this.runs = new RunStore(this.store);
  }

  async register(run: { runId: string; tenantId: string; agent: string; objective?: string }): Promise<RunRecord> {
    return this.runs.upsert({ ...run, status: "RUNNING" });
  }

  async heartbeat(runId: string, counters?: RunCounters): Promise<void> {
    const current = this.runs.get(runId);
    if (current && current.status !== "RUNNING" && current.status !== "TERMINATED") this.runs.setStatus(runId, "RUNNING");
    recordRunCounters(this.store, this.runs, runId, counters);
  }

  /**
   * Upsert + heartbeat in one call (agents call this from hooks without a separate register step). A beat means the
   * run is working, so it sets the status back to RUNNING — except for TERMINATED (an operator stop is final).
   */
  async beat(run: { runId: string; tenantId: string; agent: string }, counters?: RunCounters): Promise<void> {
    const current = this.runs.get(run.runId);
    if (!current) this.runs.upsert({ ...run, status: "RUNNING" });
    else if (current.status !== "RUNNING" && current.status !== "TERMINATED") this.runs.setStatus(run.runId, "RUNNING");
    recordRunCounters(this.store, this.runs, run.runId, counters);
  }

  async efficiencyReport(from: number, to: number, thresholds?: { maxTurns: number; maxCostUsd: number; stallMs?: number }): Promise<RegistryEfficiencyReport> {
    return aggregateRunReport(this.store, { from, to }, thresholds ?? { maxTurns: 25, maxCostUsd: 1.5, stallMs: 180_000 });
  }

  async setStatus(runId: string, status: RunStatus, error?: string): Promise<void> {
    this.runs.setStatus(runId, status, error ?? null);
  }

  /**
   * Final status, plus the run's final counters when the agent reports them (they feed the efficiency report).
   * A clean `COMPLETED` settle resets the run's recovery attempts (the next stall starts a fresh count).
   */
  async complete(runId: string, status: Extract<RunStatus, "COMPLETED" | "FAILED" | "HALTED" | "TERMINATED"> = "COMPLETED", counters?: RunCounters): Promise<void> {
    if (counters) recordRunCounters(this.store, this.runs, runId, counters);
    this.runs.setStatus(runId, status);
    if (status === "COMPLETED") this.store.exec(`UPDATE as_run_recoveries SET attempts = 0, updated_at = ? WHERE run_id = ?`, Date.now(), runId);
  }

  /** Recovery attempts since the run last settled cleanly (the sentinel fails the run past its limit). */
  async recoveryAttempts(runId: string): Promise<number> {
    return Number(this.store.exec<{ attempts: number }>(`SELECT attempts FROM as_run_recoveries WHERE run_id = ?`, runId)[0]?.attempts ?? 0);
  }

  /** Count one recovery. `attempts` resets on a clean settle; `total` never does (use it for unique idempotency keys). */
  async noteRecovery(runId: string): Promise<{ attempts: number; total: number }> {
    const row = this.store.exec<{ attempts: number; total: number }>(
      `INSERT INTO as_run_recoveries (run_id, attempts, total, updated_at) VALUES (?, 1, 1, ?)
       ON CONFLICT(run_id) DO UPDATE SET attempts = as_run_recoveries.attempts + 1, total = as_run_recoveries.total + 1, updated_at = excluded.updated_at
       RETURNING attempts, total`,
      runId,
      Date.now(),
    )[0];
    return { attempts: Number(row?.attempts ?? 1), total: Number(row?.total ?? 1) };
  }

  async stalled(thresholdMs: number): Promise<RunRecord[]> {
    if (Date.now() - this.lastPruneAt > 3_600_000) {
      this.lastPruneAt = Date.now();
      try {
        pruneRegistry(this.store);
      } catch (error) {
        console.warn("[registry] prune failed", error);
      }
    }
    return this.runs.stalled(thresholdMs);
  }

  /** Delete settled runs older than `retentionMs` (default 30 days). Also runs about hourly from `stalled()`. */
  async prune(retentionMs?: number): Promise<{ runs: number }> {
    return pruneRegistry(this.store, retentionMs !== undefined ? { retentionMs } : {});
  }

  async active(): Promise<RunRecord[]> {
    return this.runs.active();
  }

  async get(runId: string): Promise<RunRecord | null> {
    return this.runs.get(runId);
  }
}

/**
 * Control plane of one persistent agent (trusted): one instance per agent, named `${tenantId}/${agentId}`
 * (`persistentControlName`). Subclass it and implement `dispatch(trigger)` to start a turn in the Flue agent
 * (`dispatch(PersistentAgent, { id: persistentAgentInstanceId(...), signal: heartbeatSignal(trigger), initialData })`),
 * and optionally `telemetrySinks()`. The agent reports back with `recordTurn` / `recordReview`, proposes with
 * `propose` and reaches its memory through `memoryWrite` / `memoryRecall`; it can never set config.
 *
 *   wrangler: durable_objects.bindings += { name: "PERSISTENT_CONTROL", class_name: "PersistentControl" }
 *             migrations += { tag: "vN", new_sqlite_classes: ["PersistentControl"] }
 */
export class PersistentAgentControl<Env = unknown> extends DurableObject<Env> {
  protected readonly engine: PersistentControlEngine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.engine = new PersistentControlEngine(DurableObjectSqlStore.fromState(ctx), {
      dispatch: (trigger) => this.dispatch(trigger),
      setAlarm: async (at) => {
        if (at === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(at);
      },
      now: () => this.now(),
      sinks: () => this.telemetrySinks(),
    });
  }

  /** Start one agent turn. Return quickly; the agent calls `recordTurn` when it is done. Default: no agent wired. */
  protected async dispatch(_trigger: PersistentTrigger): Promise<void> {
    throw new Error("PersistentAgentControl.dispatch is not implemented: subclass it in your Worker.");
  }

  protected telemetrySinks(): TelemetrySink[] {
    return [];
  }

  protected now(): number {
    return Date.now();
  }

  private guard<T>(fn: () => T): T | { error: ControlErrorShape } {
    try {
      return fn();
    } catch (error) {
      return { error: toControlErrorShape(error) };
    }
  }

  // ---- RPC surface -----------------------------------------------------------
  async getState(): Promise<PersistentControlState> {
    return this.engine.state();
  }

  async getConfig(): Promise<PersistentAgentConfig | null> {
    return this.engine.config();
  }

  async putConfig(tenantId: string, agentId: string, config: unknown, expectedVersion: number, actor: ControlActor & { userId: string }): Promise<PutConfigResult | { error: ControlErrorShape }> {
    const result = this.guard(() => this.engine.putConfig(tenantId, agentId, config, expectedVersion, actor));
    if (!("error" in result)) await this.engine.arm();
    return result;
  }

  /** The agent's (and the owner's) only way to change config. */
  async propose(input: { patch: unknown; reason?: string; source: "agent" | "owner"; actor: string }): Promise<ConfigProposal> {
    const proposal = this.engine.propose(input);
    await this.engine.arm();
    return proposal;
  }

  async listProposals(status?: ConfigProposal["status"]): Promise<ConfigProposal[]> {
    return this.engine.listProposals(status);
  }

  async decideProposal(id: string, decision: "approve" | "reject", actor: string, note?: string): Promise<{ proposal: ConfigProposal; config?: PersistentAgentConfig } | { error: ControlErrorShape }> {
    const result = this.guard(() => this.engine.decideProposal(id, decision, actor, note));
    if (!("error" in result)) await this.engine.arm();
    return result;
  }

  async disable(actor: string): Promise<PersistentStatus> {
    return this.engine.disable(actor);
  }

  async enable(actor: string): Promise<PersistentStatus> {
    return this.engine.enable(actor);
  }

  /** The kill switch as the agent's `killSwitch()` reads it (true = locked). */
  async isKilled(): Promise<boolean> {
    return this.engine.isKilled();
  }

  async recordTurn(summary: TurnSummary): Promise<void> {
    this.engine.recordTurn(summary);
  }

  async recordReview(entry: { turnId?: string; tool: string; decision: "approve" | "block" | "escalate"; reason: string; by?: string }): Promise<void> {
    this.engine.recordReview(entry);
  }

  async readAudit(cursor?: number | null, limit?: number): Promise<{ entries: AuditEntry[]; nextCursor?: number }> {
    return this.engine.readAudit(cursor ?? null, limit ?? 50);
  }

  async memoryWrite(input: MemoryWriteInput): Promise<MemoryEntry> {
    return this.engine.memoryWrite(input);
  }

  async memoryRecall(query: string, limit?: number): Promise<string> {
    return this.engine.memory.recallRendered(query, limit ?? 8);
  }

  async memorySnapshot(actor: string): Promise<{ id: string; takenAt: number; entries: number }> {
    return this.engine.memorySnapshot(actor);
  }

  async memorySnapshots(): Promise<Array<{ id: string; takenAt: number; entries: number }>> {
    return this.engine.memory.snapshots();
  }

  async memoryRollback(snapshotId: string, actor: string): Promise<number | { error: ControlErrorShape }> {
    return this.guard(() => this.engine.memoryRollback(snapshotId, actor));
  }

  /** Re-arm the alarm (after deploys or manual repairs). */
  async kick(): Promise<number | null> {
    return this.engine.arm();
  }

  override async alarm(): Promise<void> {
    await this.engine.onAlarm();
  }
}
