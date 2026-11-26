import { DurableObjectSqlStore, RunRegistry } from "@agent-starter/cloudflare";
import type { Env } from "../env.ts";
import { drainWebhookOutbox, insertOutboxRow, type OutboxDrainResult, type OutboxEntry, outboxBacklog } from "./outbox.ts";
import { signingSecret } from "./policy.ts";

/** Cumulative counters the hook and the VM meter reported for a run (`as_run_counters`). */
export interface RunCounterTotals {
  tokens: number;
  toolCalls: number;
  vmSeconds: number;
  vmCostUsd: number;
}

/**
 * Global liveness ledger for every agent run (heartbeats from useAgentStarter,
 * status from the Flue observer). The minute cron sweeps it for silent deadlocks.
 *
 * It also holds the durable webhook outbox (src/lib/outbox.ts, table `as_outbox` from the core migrations):
 * signed deliveries to the SaaS that failed their immediate retries, wherever they were sent from (agents,
 * routes, crons), retried by the minute cron through `drainOutbox()`.
 */
export class AgentRunRegistry extends RunRegistry<Env> {
  private readonly sql = DurableObjectSqlStore.fromState(this.ctx);

  async outboxEnqueue(entry: OutboxEntry): Promise<void> {
    insertOutboxRow(this.sql, entry);
  }

  /** Retry due deliveries (re-signed with the current OUTBOUND_WEBHOOK_SECRET), prune old rows, report the backlog. */
  async drainOutbox(limit = 50): Promise<OutboxDrainResult> {
    const secret = signingSecret(this.env, "outbound");
    if (!secret) return { delivered: 0, failed: 0, ...outboxBacklog(this.sql) };
    return drainWebhookOutbox(this.sql, secret, { limit });
  }

  /** The run's cumulative counters (tokens, tool calls, VM seconds and cost), or null when it reported none. */
  async runCounters(runId: string): Promise<RunCounterTotals | null> {
    const row = this.sql.exec<{ tokens: number; tool_calls: number; vm_seconds: number; vm_cost_usd: number }>(`SELECT tokens, tool_calls, vm_seconds, vm_cost_usd FROM as_run_counters WHERE run_id = ?`, runId)[0];
    return row ? { tokens: Number(row.tokens), toolCalls: Number(row.tool_calls), vmSeconds: Number(row.vm_seconds), vmCostUsd: Number(row.vm_cost_usd) } : null;
  }
}
