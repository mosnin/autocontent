import { type AnyAgentTool, defineAgentTool, type ToolFirewallPolicy } from "@agent-starter/core";
import * as v from "valibot";
import { getMetricsSummary } from "../marketer/tools/analytics.ts";
import { createCarousel, createVideo, getCarousel, getVideo, getVideoMetrics, listCarousels, listVideos } from "../marketer/tools/content.ts";
import { getCampaign } from "../marketer/tools/distribution.ts";
import { marketerReadTools } from "../marketer/tools/index.ts";
import { createArticle, getArticle, listArticles } from "../marketer/tools/seo.ts";
import { getPlaybook, getPlaybookPerformance } from "../marketer/tools/strategy.ts";
import { decideInboxItem } from "../marketer/tools/workspace.ts";

/**
 * The in-page Marketer copilot's tools: typed, guarded wrappers over the Marketer REST API (src/marketer/tools/*),
 * never a raw HTTP passthrough. It reads what the page shows (workspace, playbooks, videos, carousels, articles,
 * campaigns, metrics), can start content on the page's playbook (MEDIUM: spends content credits) and can decide an
 * inbox item (HIGH: publishes or discards, always a person's approval). Paid media and brand changes stay with
 * Marketer's departments. Every call carries the session's tenant (`x-tenant-id` from ctx, never from args).
 */

export const navigateUi = defineAgentTool({
  name: "navigate_ui",
  description: "Ask the Marketer web app to navigate the user to a page (the sidebar performs the navigation client-side), e.g. /inbox, /analytics, /content/videos/<id>.",
  input: v.object({ path: v.pipe(v.string(), v.regex(/^\/[A-Za-z0-9/_?=&.-]{0,299}$/, "path must be an app-relative path"), v.check((p) => !p.includes("..") && !p.startsWith("//"), "no traversal")), label: v.pipe(v.string(), v.maxLength(80)) }),
  risk: "LOW",
  sideEffect: "none",
  outputTrust: "trusted",
  execute: async ({ path, label }) => ({ action: "navigate", path, label }),
});

/** Per-run quotas for the copilot (and per MCP request). */
export const appApiFirewall: ToolFirewallPolicy = {
  maxCallsPerTool: 20,
  maxTotalCalls: 60,
};

export function appApiTools(): AnyAgentTool[] {
  return [
    ...marketerReadTools(),
    getPlaybook,
    getPlaybookPerformance,
    listVideos,
    getVideo,
    getVideoMetrics,
    listCarousels,
    getCarousel,
    listArticles,
    getArticle,
    getCampaign,
    getMetricsSummary,
    createVideo,
    createCarousel,
    createArticle,
    decideInboxItem,
    navigateUi as unknown as AnyAgentTool,
  ];
}
