import { type MarketerCallContext, marketerApi } from "./api.ts";
import { decide, type DecisionRuntime, resolveMode } from "./decisions/run.ts";
import { AUTOPILOT_RULE, overSpendPace } from "./decisions/tables.ts";

/**
 * Marketer's always-on loop: the recommended config for the persistent agent. Create it once per account as the
 * account owner (tenant admin) with `PUT /api/persistent/marketer-autopilot/config` and
 * `{ config: marketerAutopilotConfig(ownerUserId, apiHost), expectedVersion: 0 }` (see README "Always-on loop").
 *
 * The agent reaches the Marketer API only through the credential broker (`saas` credential bound to the API host)
 * and the managed egress allowlist (`PERSISTENT_EGRESS_ALLOW` must list the same host). It never spends or
 * publishes: its only acting tool, `propose_next_moves`, always waits for the owner's approval.
 */
export const MARKETER_AUTOPILOT_ID = "marketer-autopilot";

export const MARKETER_HEARTBEAT = `# Marketer autopilot checklist
Work top to bottom. Read first; propose at most ONE plan per tick. Reply exactly HEARTBEAT_OK when nothing applies.

1. Inbox: call get_workspace_inbox. If items have waited more than 24 hours, include "review N items in the inbox" in your plan (you never decide them).
2. Failures: call get_workspace_activity. If any job, article or carousel failed since the last tick, note the error; propose a retry only when the error looks transient.
3. Performance: call get_workspace_overview with days 7. If views or engagements dropped more than 20% vs the previous period, or one content piece is far above the rest, propose what to make more or less of (department + concrete next step).
4. Spend: call get_spend_today. If today's content spend is above 80% of the sum of playbook caps, or ad spend jumped more than 30% vs the previous period, flag it first in the plan.
5. Pipeline: if nothing is in progress and nothing is scheduled for the next 3 days, propose the next batch (which playbook, what to make, on which platform, the expected cost in USD).

Ignore: small day-to-day noise (under 10%), items already proposed in an earlier tick that are still pending, and anything you cannot measure with your tools.
When something applies, call propose_next_moves once with every move for this tick, then end with a short report.`;

/** Recommended config body for the control plane (heartbeat every 6 hours, quiet at night, no web egress but the API). */
export function marketerAutopilotConfig(ownerUserId: string, apiHost: string, tz = "UTC") {
  return {
    agentId: MARKETER_AUTOPILOT_ID,
    name: "Marketer autopilot",
    ownerUserId,
    heartbeatMinutes: 360,
    heartbeat: MARKETER_HEARTBEAT,
    quietHours: { tz, start: "22:00", end: "07:00" },
    egress: { allow: [apiHost], deny: [] },
    credentials: [{ name: "saas", hosts: [apiHost] }],
    dailyBudgetUsd: 1,
    maxToolCallsPerTick: 8,
  };
}

// ── Decision point 12: anything worth proposing? goal met? ───────────────────────────────────────────────────────
// Runs when the autopilot calls propose_next_moves (through MarketerReviewer, src/marketer/decisions/hooks.ts).
// Shadow (default with a key): logs the judgment, the checklist decides as today. Enforce: a confident "goal met"
// with no stale inbox item and spend on pace holds the proposal (no proposal is the safe side). It never adds one.

/** What the autopilot read this tick (each piece optional: a failed read just leaves it out). */
export interface AutopilotReadings {
  overview?: unknown;
  inbox?: unknown;
  spendToday?: { spentUsd: number; dailyCapUsd?: number };
  /** Hour of day (0-23) in the account's time zone, for the spend pace. */
  hour: number;
}

/** Read the account the way the checklist does (inbox, spend today, 7-day overview). Never throws. */
export async function readAutopilotState(ctx: MarketerCallContext, hour = new Date().getUTCHours()): Promise<AutopilotReadings> {
  const get = (path: string, query?: Record<string, number>) => marketerApi(ctx, { method: "GET", path, ...(query ? { query } : {}) }).catch(() => undefined);
  const [overview, inbox, spend, playbooks] = await Promise.all([get("/workspace/overview", { days: 7 }), get("/workspace/inbox"), get("/spend/today"), get("/niches")]);
  return { overview, inbox, hour, ...(spend !== undefined ? { spendToday: spendFrom(spend, playbooks) } : {}) };
}

/**
 * Today's spend (`GET /spend/today` → total_usd) and the sum of the playbooks' daily caps (`GET /niches` →
 * daily_spend_cap_usd), the same numbers checklist step 4 uses. Shape-tolerant; arithmetic stays in code.
 */
export function spendFrom(spend: unknown, playbooks?: unknown): { spentUsd: number; dailyCapUsd?: number } {
  const money = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number.isFinite(Number(x)) ? Number(x) : undefined);
  const spentUsd = money((spend as Record<string, unknown> | null)?.total_usd) ?? 0;
  const list = Array.isArray(playbooks) ? playbooks : Array.isArray((playbooks as { items?: unknown } | null)?.items) ? (playbooks as { items: unknown[] }).items : [];
  const caps = list.map((p) => money((p as Record<string, unknown> | null)?.daily_spend_cap_usd)).filter((n): n is number => n !== undefined);
  const dailyCapUsd = caps.length ? Math.round(caps.reduce((a, b) => a + b, 0) * 100) / 100 : undefined;
  return { spentUsd, ...(dailyCapUsd !== undefined ? { dailyCapUsd } : {}) };
}

/**
 * Decision point 12 for one proposal. `read` is only called when the point is not off (no key: no extra API reads).
 * `objective` is the owner's goal as the harness tracks it.
 */
export async function autopilotDecision(runtime: DecisionRuntime, tenantId: string, read: () => Promise<AutopilotReadings>, objective?: string): Promise<{ action: "proceed" | "hold"; reason: string }> {
  if (resolveMode(runtime.env, "autopilot") === "off") return AUTOPILOT_RULE;
  const readings = await read();
  const overPace = readings.spendToday ? overSpendPace(readings.spendToday.spentUsd, readings.spendToday.dailyCapUsd, readings.hour) : false;
  const outcome = await decide(runtime, "autopilot", {
    state: { objective: (objective ?? "").slice(0, 1000), overview: readings.overview ?? null, inbox: readings.inbox ?? null },
    facts: { overPace },
    tenantId,
  });
  return outcome.action;
}
