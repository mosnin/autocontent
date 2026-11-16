import type { AnyAgentTool } from "@agent-starter/core";
import * as v from "valibot";
import { limit, reason, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";

/**
 * The workspace: Marketer's one source of truth across departments (backend/routes/workspace.py).
 *   GET  /workspace/overview?days=     KPIs (spend in USD, posts, articles, views, engagements, ad clicks/conversions),
 *                                      previous-period KPIs, daily series, pipeline counts, top content
 *   GET  /workspace/inbox              everything waiting on a person: videos, carousels, ad changes
 *   GET  /workspace/activity           what moved, newest first (cursor `before`)
 *   POST /workspace/inbox/{kind}/{ref_id}/decide {decision}   approve / reject one inbox item
 */

export const getWorkspaceOverview = readTool({
  name: "get_workspace_overview",
  description: "Read the marketing overview for the last N days: spend (total, content, ads) in USD, posts and articles published, views, engagements, ad clicks and conversions, the previous period for comparison, a daily series, pipeline counts (active/done/failed, pending ad approvals) and top content.",
  input: v.object({ days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)), 7) }),
  request: ({ days }) => ({ method: "GET", path: "/workspace/overview", query: { days } }),
});

export const getWorkspaceInbox = readTool({
  name: "get_workspace_inbox",
  description: "List everything waiting on a person's decision (videos and carousels awaiting approval before posting, ad changes awaiting approval) with counts per kind.",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/workspace/inbox" }),
});

export const getWorkspaceActivity = readTool({
  name: "get_workspace_activity",
  description: "List recent activity across departments (jobs done/failed, articles, posts, ad actions), newest first. Pass `before` (the previous page's next_before) to page back.",
  input: v.object({ limit: limit(100, 20), before: v.optional(v.pipe(v.string(), v.maxLength(100), v.regex(/^[A-Za-z0-9_.:+-]+$/))) }),
  request: ({ limit: n, before }) => ({ method: "GET", path: "/workspace/activity", query: { limit: n, before } }),
});

/**
 * Decide one content item in the inbox (video or carousel). Approving publishes it to the connected channels, and a
 * rejection discards the rendered post: either way a person must confirm, so HIGH. Ad changes are decided only by
 * the media buyer's `decide_ad_approval` (CRITICAL: approving executes the spend).
 */
export const decideInboxItem = writeTool({
  name: "decide_inbox_item",
  description: "Approve (publishes to the connected social channels) or reject (discards) a video or carousel waiting in the inbox.",
  input: v.object({ kind: v.picklist(["video", "carousel"]), refId: uuid("refId"), decision: v.picklist(["approve", "reject"]), reason }),
  risk: "HIGH",
  sideEffect: "external",
  // The inbox decision is an atomic claim: a repeat answers 409 instead of posting twice.
  idempotent: true,
  request: ({ kind, refId, decision }) => ({ method: "POST", path: `/workspace/inbox/${seg(kind)}/${seg(refId)}/decide`, body: { decision } }),
});

/** Read-only workspace tools every Marketer agent may use (overview, inbox, activity). */
export function workspaceReadTools(): AnyAgentTool[] {
  return [getWorkspaceOverview, getWorkspaceInbox, getWorkspaceActivity];
}
