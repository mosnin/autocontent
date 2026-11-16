import type { AnyAgentTool, ToolFirewallPolicy } from "@agent-starter/core";
import * as v from "valibot";
import { limit, reason, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";

/**
 * Paid media (strictly governed). Endpoints: /ads/accounts, /ads/campaigns, /ads/approvals, /ads/actions,
 * /ads/overview. The backend's safe-execute layer is fail-closed on its own (account kill switch, daily and monthly
 * caps, approval threshold, a full audit log, 402 on any hard deny); these tools add the agent side:
 *
 *  - reads LOW;
 *  - connecting an account (starts an OAuth flow a person completes) and drafting a campaign (never on a platform
 *    until activated) MEDIUM, but the media buyer runs with `maxAutonomousTier: "LOW"`, so even those wait for a
 *    person;
 *  - pausing / ending a campaign HIGH (changes live ads);
 *  - changing a budget, activating a campaign and deciding an ad approval (approving EXECUTES the spend) CRITICAL:
 *    always a human approval, every time, plus the backend guard;
 *  - money inputs are bounded in the schema (MAX_DAILY_BUDGET_USD) and capped per run by `adsFirewall`.
 */

/** The largest daily budget the agent may ever propose (the account caps in the backend are usually lower). */
export const MAX_DAILY_BUDGET_USD = 1_000;
const money = (max: number) => v.pipe(v.number(), v.minValue(0), v.maxValue(max));

export const getAdsOverview = readTool({
  name: "get_ads_overview",
  description: "Paid-media summary: ad spend today and month to date in USD, active campaigns, pending approvals, per account.",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/ads/overview" }),
});

export const listAdAccounts = readTool({
  name: "list_ad_accounts",
  description: "List connected ad accounts with their governance (status, kill switch, daily and monthly caps in USD, approval threshold).",
  input: v.object({}),
  request: () => ({ method: "GET", path: "/ads/accounts" }),
});

export const listAdCampaigns = readTool({
  name: "list_ad_campaigns",
  description: "List ad campaigns (status, daily budget in USD), optionally for one account.",
  input: v.object({ accountId: v.optional(uuid("accountId")) }),
  request: ({ accountId }) => ({ method: "GET", path: "/ads/campaigns", query: { account_id: accountId } }),
});

export const getAdCampaign = readTool({
  name: "get_ad_campaign",
  description: "Read one ad campaign with its daily metrics (spend in USD, impressions, clicks, conversions).",
  input: v.object({ campaignId: uuid("campaignId") }),
  request: ({ campaignId }) => ({ method: "GET", path: `/ads/campaigns/${seg(campaignId)}` }),
});

export const listAdApprovals = readTool({
  name: "list_ad_approvals",
  description: "List ad approvals (budget changes and activations over the approval threshold), optionally by status (pending, approved, rejected, executed).",
  input: v.object({ status: v.optional(v.picklist(["pending", "approved", "rejected", "executed"])) }),
  request: ({ status }) => ({ method: "GET", path: "/ads/approvals", query: { status_filter: status } }),
});

export const listAdActions = readTool({
  name: "list_ad_actions",
  description: "The paid-media audit log: every campaign, budget, status and approval action with who did it and the dollar delta.",
  input: v.object({ limit: limit(500, 50) }),
  request: ({ limit: n }) => ({ method: "GET", path: "/ads/actions", query: { limit: n } }),
});

export const connectAdAccount = writeTool({
  name: "connect_ad_account",
  description: "Start connecting an ad account (returns an authorization URL the PERSON must open; nothing is spent).",
  input: v.object({ platform: v.picklist(["google_ads", "meta_ads"]) }),
  risk: "MEDIUM",
  sideEffect: "external",
  request: ({ platform }) => ({ method: "POST", path: "/ads/accounts/connect", body: { platform } }),
});

export const createAdCampaign = writeTool({
  name: "create_ad_campaign",
  description: `Create a DRAFT ad campaign on a connected account with an intended daily budget in USD (at most ${MAX_DAILY_BUDGET_USD}). Drafts never run or spend until activate_ad_campaign is approved and passes the account guard.`,
  input: v.object({
    adAccountId: uuid("adAccountId"),
    name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
    objective: v.optional(v.pipe(v.string(), v.maxLength(100)), ""),
    dailyBudgetUsd: v.optional(money(MAX_DAILY_BUDGET_USD)),
    playbookId: v.optional(uuid("playbookId")),
  }),
  risk: "MEDIUM",
  request: (a) => ({ method: "POST", path: "/ads/campaigns", body: { ad_account_id: a.adAccountId, name: a.name, objective: a.objective, daily_budget_usd: a.dailyBudgetUsd ?? null, niche_id: a.playbookId ?? null } }),
});

export const setAdBudget = writeTool({
  name: "set_ad_budget",
  description: `Change an ad campaign's DAILY budget in USD (moves real money; at most ${MAX_DAILY_BUDGET_USD}). The backend guard may still deny it (402) or park it as an ad approval; report the outcome in dollars.`,
  input: v.object({ campaignId: uuid("campaignId"), dailyBudgetUsd: money(MAX_DAILY_BUDGET_USD), currentDailyBudgetUsd: money(1_000_000), reason }),
  risk: "CRITICAL",
  sideEffect: "external",
  requiresApproval: true,
  tags: ["paid-media"],
  request: ({ campaignId, dailyBudgetUsd }) => ({ method: "POST", path: `/ads/campaigns/${seg(campaignId)}/budget`, body: { daily_budget_usd: dailyBudgetUsd } }),
});

export const activateAdCampaign = writeTool({
  name: "activate_ad_campaign",
  description: "Activate an ad campaign so it starts spending its daily budget (moves real money). The backend guard checks account caps and kill switch and may park it as an ad approval.",
  input: v.object({ campaignId: uuid("campaignId"), dailyBudgetUsd: money(MAX_DAILY_BUDGET_USD), reason }),
  risk: "CRITICAL",
  sideEffect: "external",
  requiresApproval: true,
  tags: ["paid-media"],
  request: ({ campaignId }) => ({ method: "POST", path: `/ads/campaigns/${seg(campaignId)}/status`, body: { status: "active" } }),
});

export const pauseAdCampaign = writeTool({
  name: "pause_ad_campaign",
  description: "Pause or end a live ad campaign (stops spend; ended is final).",
  input: v.object({ campaignId: uuid("campaignId"), status: v.picklist(["paused", "ended"]), reason }),
  risk: "HIGH",
  sideEffect: "external",
  idempotent: true,
  tags: ["paid-media"],
  request: ({ campaignId, status }) => ({ method: "POST", path: `/ads/campaigns/${seg(campaignId)}/status`, body: { status } }),
});

export const decideAdApproval = writeTool({
  name: "decide_ad_approval",
  description: "Decide a pending ad approval. APPROVED immediately executes the budget change or activation (moves real money); REJECTED executes nothing.",
  input: v.object({ approvalId: uuid("approvalId"), decision: v.picklist(["approved", "rejected"]), dollarDeltaUsd: money(1_000_000), reason }),
  risk: "CRITICAL",
  sideEffect: "external",
  requiresApproval: true,
  tags: ["paid-media"],
  request: ({ approvalId, decision }) => ({ method: "POST", path: `/ads/approvals/${seg(approvalId)}/decide`, body: { decision } }),
});

/**
 * Per-run quotas for the media buyer (on top of approvals): no tool more than 10 calls per run, 40 calls in total,
 * so a delegated task can never fan out into a storm of spend changes; pause_ad_campaign can never go live.
 */
export const adsFirewall: ToolFirewallPolicy = {
  maxCallsPerTool: 10,
  maxTotalCalls: 40,
  argumentRules: [{ tool: "pause_ad_campaign", path: "status", allow: /^(paused|ended)$/, message: "pause_ad_campaign only pauses or ends; use activate_ad_campaign to go live." }],
};

/** The money tools (CRITICAL), for policies and tests. */
export const MONEY_TOOLS = ["set_ad_budget", "activate_ad_campaign", "decide_ad_approval"] as const;

/** The media buyer's department tools. */
export function adsTools(): AnyAgentTool[] {
  return [getAdsOverview, listAdAccounts, listAdCampaigns, getAdCampaign, listAdApprovals, listAdActions, connectAdAccount, createAdCampaign, setAdBudget, activateAdCampaign, pauseAdCampaign, decideAdApproval];
}
