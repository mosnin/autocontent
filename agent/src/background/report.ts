import type { Env } from "../env.ts";
import { budgetLimits, notifier, registry, sendToSaas } from "../lib/platform.ts";

/** Anomaly thresholds of the daily report: the config's budget ceilings (agent-starter.config.ts) and the sentinel's 180 s stall. */
export function reportThresholds(limits: { maxCostUsd: number; maxTurns: number } = budgetLimits()): { maxTurns: number; maxCostUsd: number; stallMs: number } {
  return { maxTurns: limits.maxTurns, maxCostUsd: limits.maxCostUsd, stallMs: 180_000 };
}

/**
 * Daily token & compute efficiency report (cron). Aggregates the run registry
 * ledger: jobs, cost, turns, routing density and anomalies (runaway loops,
 * budget breaches, stalls, measured against agent-starter.config.ts budget) — sent to the SaaS webhook
 * (durable outbox on failure) and/or the ops inbox.
 */
export async function dailyEfficiencyReport(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
  const to = Date.now();
  const report = await registry(env).efficiencyReport(to - 24 * 3600_000, to, reportThresholds());
  if (env.PRIMARY_SAAS_WEBHOOK_URL) await sendToSaas({ type: "report.daily_efficiency", report }, { tenantId: "platform", eventType: "report.daily_efficiency" });
  const n = notifier();
  if (n && env.OPS_ALERT_EMAIL && report.anomalies.length) {
    await n.notify({
      tenantId: "platform",
      to: env.OPS_ALERT_EMAIL,
      subject: `Agent efficiency: ${report.anomalies.length} anomalies, $${report.summary.totalExecutionCostUsd.toFixed(2)} spent`,
      text: JSON.stringify(report, null, 2),
      threadKey: "reports:daily",
    });
  }
}
