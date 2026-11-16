import { z } from "zod";
import { HttpError } from "../errors.ts";
import type { SqlStore } from "../storage/ports.ts";

export const EfficiencyReportSchema = z.object({
  window: z.object({ from: z.number(), to: z.number() }),
  summary: z.object({ totalJobs: z.number(), totalExecutionCostUsd: z.number(), averageJobCostUsd: z.number(), totalVmSeconds: z.number() }),
  kpis: z.object({
    firstLineRoutingDensity: z.number().describe("Share of routing decisions served by first-line (edge) models instead of the frontier model."),
    averageTurnsPerJob: z.number(),
    averageVmRunSeconds: z.number(),
    tokensPerDollar: z.number(),
    /** Cost of VMs that ran until the hardware TTL instead of being stopped by the agent (leaked compute). */
    infrastructureLeakedCostUsd: z.number().optional(),
  }),
  anomalies: z.array(z.object({ runId: z.string(), tenantId: z.string(), issue: z.enum(["ROGUE_LOOP_DETECTED", "BUDGET_LIMIT_BREACHED", "STALLED"]), accumulatedCostUsd: z.number(), turnCount: z.number() })),
});
export type EfficiencyReport = z.infer<typeof EfficiencyReportSchema>;

/**
 * Token & compute efficiency reporting over the run ledger (an agent's own
 * SQLite, or a warehouse/D1 copy fed by WarehouseSync). Surfaces margin KPIs and
 * runaway tenants hitting circuit breakers.
 */
export function generateEfficiencyReport(sql: SqlStore, window: { from: number; to: number }, thresholds: { maxTurns: number; maxCostUsd: number; stallMs?: number } = { maxTurns: 25, maxCostUsd: 1.5 }): EfficiencyReport {
  const runs = sql.exec<{ run_id: string; tenant_id: string; status: string; turn_count: number; cost_usd: number; last_heartbeat_at: number }>(
    `SELECT run_id, tenant_id, status, turn_count, cost_usd, last_heartbeat_at FROM as_runs WHERE created_at BETWEEN ? AND ?`,
    window.from,
    window.to,
  );
  const ledger = sql.exec<{ cost: number | null; tokens: number | null; vm: number | null; vm_runs: number | null }>(
    `SELECT SUM(cost_usd) AS cost, SUM(input_tokens + output_tokens + reasoning_tokens) AS tokens, SUM(vm_seconds) AS vm, SUM(CASE WHEN kind = 'vm' THEN 1 ELSE 0 END) AS vm_runs
     FROM as_budget_ledger WHERE created_at BETWEEN ? AND ?`,
    window.from,
    window.to,
  )[0] ?? { cost: 0, tokens: 0, vm: 0, vm_runs: 0 };
  const routes = sql.exec<{ profile: string; n: number }>(`SELECT profile, COUNT(*) AS n FROM as_router_log WHERE created_at BETWEEN ? AND ? GROUP BY profile`, window.from, window.to);
  const totalRoutes = routes.reduce((s, r) => s + Number(r.n), 0);
  const firstLine = routes.filter((r) => /first|edge|workers|small|cheap/i.test(r.profile)).reduce((s, r) => s + Number(r.n), 0);
  const totalCost = Number(ledger.cost ?? 0);
  const anomalies: EfficiencyReport["anomalies"] = [];
  for (const run of runs) {
    const cost = Number(run.cost_usd);
    const turns = Number(run.turn_count);
    if (cost >= thresholds.maxCostUsd) anomalies.push({ runId: run.run_id, tenantId: run.tenant_id, issue: "BUDGET_LIMIT_BREACHED", accumulatedCostUsd: cost, turnCount: turns });
    else if (turns >= thresholds.maxTurns) anomalies.push({ runId: run.run_id, tenantId: run.tenant_id, issue: "ROGUE_LOOP_DETECTED", accumulatedCostUsd: cost, turnCount: turns });
    else if (thresholds.stallMs && run.status === "RUNNING" && Date.now() - Number(run.last_heartbeat_at) > thresholds.stallMs)
      anomalies.push({ runId: run.run_id, tenantId: run.tenant_id, issue: "STALLED", accumulatedCostUsd: cost, turnCount: turns });
  }
  return {
    window,
    summary: { totalJobs: runs.length, totalExecutionCostUsd: totalCost, averageJobCostUsd: runs.length ? totalCost / runs.length : 0, totalVmSeconds: Number(ledger.vm ?? 0) },
    kpis: {
      firstLineRoutingDensity: totalRoutes ? firstLine / totalRoutes : 0,
      averageTurnsPerJob: runs.length ? runs.reduce((s, r) => s + Number(r.turn_count), 0) / runs.length : 0,
      averageVmRunSeconds: Number(ledger.vm_runs ?? 0) ? Number(ledger.vm ?? 0) / Number(ledger.vm_runs) : 0,
      tokensPerDollar: totalCost > 0 ? Number(ledger.tokens ?? 0) / totalCost : 0,
    },
    anomalies,
  };
}

/**
 * Buffered metric flushing from edge SQLite to the primary data warehouse.
 * Rows are sent in batches (default 50) and marked in a sync ledger only after a
 * 2xx response — no duplicate accounting, no data loss on failure.
 */
export class WarehouseSync {
  constructor(
    private readonly sql: SqlStore,
    private readonly options: { endpoint: string; token: string; tenantId: string; batchSize?: number; fetch?: typeof fetch },
  ) {}

  async flush(): Promise<{ flushedCount: number }> {
    const rows = this.sql.exec<{ id: number; run_id: string; kind: string; model: string | null; input_tokens: number; output_tokens: number; reasoning_tokens: number; cost_usd: number; vm_seconds: number; created_at: number }>(
      `SELECT l.* FROM as_budget_ledger l LEFT JOIN as_sync_ledger s ON l.id = s.ledger_id WHERE s.ledger_id IS NULL ORDER BY l.id LIMIT ?`,
      this.options.batchSize ?? 50,
    );
    if (rows.length === 0) return { flushedCount: 0 };
    const response = await (this.options.fetch ?? fetch)(this.options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        batch: rows.map((r) => ({
          tenantId: this.options.tenantId,
          edgeLedgerId: r.id,
          runId: r.run_id,
          kind: r.kind,
          model: r.model,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          reasoningTokens: r.reasoning_tokens,
          costUsd: r.cost_usd,
          vmSeconds: r.vm_seconds,
          recordedAt: new Date(Number(r.created_at)).toISOString(),
        })),
      }),
    });
    if (!response.ok) throw await HttpError.fromResponse(response, "Warehouse sync");
    const now = Date.now();
    this.sql.transaction(() => {
      for (const row of rows) this.sql.exec(`INSERT OR IGNORE INTO as_sync_ledger (ledger_id, synced_at) VALUES (?, ?)`, row.id, now);
    });
    return { flushedCount: rows.length };
  }
}
