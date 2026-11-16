import type { AnyAgentTool } from "@agent-starter/core";
import * as v from "valibot";
import { uuid } from "../api.ts";
import { getAdCampaign, getAdsOverview } from "./ads.ts";
import { getVideoMetrics } from "./content.ts";
import { readTool } from "./define.ts";
import { getPlaybookPerformance } from "./strategy.ts";
import { getWorkspaceActivity, getWorkspaceOverview } from "./workspace.ts";

/**
 * Analytics department: performance across organic video, articles and paid ads. Read-only, every tool LOW.
 * Endpoints: /workspace/overview, /spend/today, /spend/history, /metrics/summary, /niches/{id}/performance,
 * /jobs/{id}/metrics, /ads/overview, /ads/campaigns/{id}.
 */

export const getSpendToday = readTool({
  name: "get_spend_today",
  description: "Content spend so far today in USD, total and per playbook (bucket 'other' = spend without a playbook, e.g. remixes).",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/spend/today" }),
});

export const getSpendHistory = readTool({
  name: "get_spend_history",
  description: "Content spend per day in USD over the last N days (1-90), optionally for one playbook.",
  input: v.object({ days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)), 30), playbookId: v.optional(uuid("playbookId")) }),
  request: ({ days, playbookId }) => ({ method: "GET", path: "/spend/history", query: { days, niche_id: playbookId } }),
});

export const getMetricsSummary = readTool({
  name: "get_metrics_summary",
  description: "Organic video performance over the last 30 days: totals (views, likes, comments, shares), sampled videos and the best video.",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/metrics/summary" }),
});

/** The analyst's department tools (all read-only). */
export function analyticsTools(): AnyAgentTool[] {
  return [getWorkspaceOverview, getWorkspaceActivity, getSpendToday, getSpendHistory, getMetricsSummary, getPlaybookPerformance, getVideoMetrics, getAdsOverview, getAdCampaign];
}
