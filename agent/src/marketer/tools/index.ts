import type { AnyAgentTool, ToolFirewallPolicy } from "@agent-starter/core";
import { adsTools } from "./ads.ts";
import { analyticsTools, getSpendToday } from "./analytics.ts";
import { contentTools } from "./content.ts";
import { distributionTools, getCalendar, getChannelStatus } from "./distribution.ts";
import { seoTools } from "./seo.ts";
import { listPlaybooks, strategyTools } from "./strategy.ts";
import { getWorkspaceActivity, getWorkspaceInbox, getWorkspaceOverview } from "./workspace.ts";

export { adsFirewall, MAX_DAILY_BUDGET_USD, MONEY_TOOLS } from "./ads.ts";
export { workspaceReadTools } from "./workspace.ts";

/** Marketer's departments → the specialist that owns them (src/multi-agent/roster.ts) and its tools. */
export type Department = "strategist" | "content-producer" | "seo-editor" | "media-buyer" | "distribution-manager" | "analyst";

/** Each specialist gets ONLY its department's tools (never everything). */
export const DEPARTMENT_TOOLS: Record<Department, () => AnyAgentTool[]> = {
  strategist: strategyTools,
  "content-producer": contentTools,
  "seo-editor": seoTools,
  "media-buyer": adsTools,
  "distribution-manager": distributionTools,
  analyst: analyticsTools,
};

/**
 * Per-run quotas every department runs with (src/agents/specialists.ts): no tool more than 10 calls and 40 calls in
 * total inside one delegated task, room or bus conversation. The counters are durable (SQLite, per conversation), so
 * they hold across turns, parallel batches and restarts.
 *
 * Why every department and not only paid media: a maker (create_video, create_article, remix_template, ...) is
 * MEDIUM and runs without a person, and each call spends content credits. The model budget (turns, dollars of
 * inference) does not bound that spend: a stuck loop could start a maker on every turn, several per turn. With the
 * quota the eleventh call of one tool is denied (TOOL_NOT_ALLOWED) and the task has to report. The backend's spend
 * caps stay the last wall. The media buyer adds its own argument rule on top (`adsFirewall`).
 */
export const DEPARTMENT_FIREWALL: ToolFirewallPolicy = Object.freeze({ maxCallsPerTool: 10, maxTotalCalls: 40 });

/** Names of a department's tools (delegation grants, rosters, tests). */
export function departmentToolNames(department: Department): string[] {
  return DEPARTMENT_TOOLS[department]().map((t) => t.name);
}

/**
 * Marketer's (and the orchestrator's) own tools: read-only situational awareness. Everything that makes, publishes
 * or spends happens in a department through delegation.
 */
export function marketerReadTools(): AnyAgentTool[] {
  return [getWorkspaceOverview, getWorkspaceInbox, getWorkspaceActivity, getSpendToday, listPlaybooks, getCalendar, getChannelStatus];
}

/** The always-on loop's tools: read the overview, inbox, activity and today's spend. Nothing that acts. */
export function persistentReadTools(): AnyAgentTool[] {
  return [getWorkspaceOverview, getWorkspaceInbox, getWorkspaceActivity, getSpendToday];
}
