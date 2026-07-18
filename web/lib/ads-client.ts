// Client-safe typed client for the Ads API (/api/v1/ads). SWR keys are plain
// backend paths (clientFetch prefixes /api/proxy); mutations POST/PATCH/DELETE
// through the proxy so the Clerk JWT is attached server-side. No server-only
// imports — this runs in the browser.

import { clientFetch } from "@/lib/client-fetcher";

const ADS = "/api/v1/ads";

export type AdPlatform = "google_ads" | "meta_ads";

export interface AdAccount {
  id: string;
  user_id: string;
  platform: string;
  external_account_id: string;
  name: string;
  status: string; // pending | active | error | disconnected
  currency: string;
  daily_cap_usd: string | null;
  monthly_cap_usd: string | null;
  killswitch: boolean;
  last_error: string;
  created_at: string;
  updated_at: string;
}

export interface AdsOverview {
  accounts: number;
  active_accounts: number;
  campaigns: number;
  active_campaigns: number;
  spend_today_usd: string;
  spend_30d_usd: string;
  pending_approvals: number;
  month_start: string;
}

export interface AdApproval {
  id: string;
  action: string;
  summary: string;
  dollar_delta_usd: string;
  status: string;
  requested_by: string;
  decided_by: string;
  created_at: string;
}

export interface AdCampaign {
  id: string;
  user_id: string;
  ad_account_id: string;
  external_campaign_id: string;
  name: string;
  objective: string;
  status: string; // draft | pending | active | paused | ended | failed
  daily_budget_usd: string | null;
  lifetime_budget_usd: string | null;
  niche_id: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
}

export interface AdMetricsDaily {
  date: string;
  impressions: number;
  clicks: number;
  spend_usd: string;
  conversions: string;
  revenue_usd: string;
}

export interface AdCreative {
  id: string;
  user_id: string;
  campaign_id: string | null;
  external_id: string;
  kind: string;
  headline: string;
  body: string;
  media_path: string;
  cta: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// --- Ads experiments (creative A/B tests + governed budget ramps) ------
// Manual TS mirrors of src/marketer/repos/ad_experiments.py's AdExperiment
// / AdExperimentArm and backend/routes/experiments.py's response shapes.

export type ExperimentKind = "creative_ab" | "budget_ramp";
export type ExperimentStatus = "draft" | "running" | "completed" | "cancelled";

export interface CreativeAbConfig {
  creative_ids: string[];
  window_days: number;
}

export interface BudgetRampConfig {
  target_daily_usd: string;
  step_pct: string;
  interval_days: number;
}

export interface AdExperiment {
  id: string;
  user_id: string;
  campaign_id: string;
  kind: string; // ExperimentKind on the wire; kept loose like AdCampaign.status
  status: string; // ExperimentStatus
  config: Partial<CreativeAbConfig & BudgetRampConfig> & Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AdExperimentArm {
  id: string;
  experiment_id: string;
  creative_id: string | null;
  label: string;
  metrics: {
    impressions?: number;
    clicks?: number;
    spend_usd?: string;
    conversions?: string;
    revenue_usd?: string;
    days_attributed?: number;
    [key: string]: unknown;
  };
  is_winner: boolean;
  created_at: string;
}

export interface AdExperimentDetail {
  experiment: AdExperiment;
  arms: AdExperimentArm[];
}

export const adsKeys = {
  overview: () => `${ADS}/overview`,
  accounts: () => `${ADS}/accounts`,
  campaigns: (accountId?: string) =>
    `${ADS}/campaigns${accountId ? `?account_id=${accountId}` : ""}`,
  campaign: (id: string) => `${ADS}/campaigns/${id}`,
  approvals: (status?: string) =>
    `${ADS}/approvals${status ? `?status_filter=${status}` : ""}`,
  actions: () => `${ADS}/actions`,
  creatives: (campaignId: string) => `${ADS}/campaigns/${campaignId}/creatives`,
  experiments: (campaignId?: string) =>
    `${ADS}/experiments${campaignId ? `?campaign_id=${campaignId}` : ""}`,
  experiment: (id: string) => `${ADS}/experiments/${id}`,
};

async function proxy<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? ((await res.json()) as T) : (undefined as T);
}

/** Start OAuth for a platform. Returns a redirect_url to open, or throws with
 *  a 409 message when Ads/Composio isn't enabled. */
export function connectAccount(
  platform: AdPlatform,
): Promise<{ redirect_url: string; account_id: string; platform: string }> {
  return proxy("POST", `${ADS}/accounts/connect`, { platform });
}

export function refreshAccount(id: string): Promise<AdAccount> {
  return proxy("POST", `${ADS}/accounts/${id}/refresh`);
}

export function disconnectAccount(id: string): Promise<AdAccount> {
  return proxy("DELETE", `${ADS}/accounts/${id}`);
}

export function setGovernance(
  id: string,
  body: {
    daily_cap_usd?: string | null;
    monthly_cap_usd?: string | null;
    killswitch?: boolean;
  },
): Promise<AdAccount> {
  return proxy("PATCH", `${ADS}/accounts/${id}/governance`, body);
}

export function decideApproval(
  id: string,
  decision: "approved" | "rejected",
): Promise<AdApproval> {
  return proxy("POST", `${ADS}/approvals/${id}/decide`, { decision });
}

export function createCampaign(body: {
  ad_account_id: string;
  name: string;
  objective?: string;
  daily_budget_usd?: string | null;
}): Promise<AdCampaign> {
  return proxy("POST", `${ADS}/campaigns`, body);
}

/** Change a campaign's daily budget through the safe-execute layer. Resolves
 *  to { status: 'executed' | 'pending_approval', ... }; rejects with a 402
 *  message when governance denies. */
export function changeBudget(
  id: string,
  dailyBudgetUsd: string,
): Promise<{ status: string; approval_id?: string }> {
  return proxy("POST", `${ADS}/campaigns/${id}/budget`, {
    daily_budget_usd: dailyBudgetUsd,
  });
}

export function changeCampaignStatus(
  id: string,
  status: "active" | "paused" | "ended",
): Promise<AdCampaign> {
  return proxy("POST", `${ADS}/campaigns/${id}/status`, { status });
}

/** Generate n ad-copy variants for a campaign via the LLM copywriter and
 *  persist them. Rejects with a 409 message when Ads/Composio isn't enabled
 *  (still applies here since the same feature gate covers the account) and
 *  a 502 message when the LLM call itself fails. */
export function generateCreatives(
  campaignId: string,
  count = 3,
): Promise<AdCreative[]> {
  return proxy("POST", `${ADS}/campaigns/${campaignId}/creatives`, { count });
}

/** Create a DRAFT experiment. No spend happens until start()/advance().
 *  Rejects with a 422 message on a bad config shape (wrong creative count,
 *  step_pct over the 20% cap, etc) or 404 when the campaign (or a
 *  referenced creative) isn't found. */
export function createExperiment(body: {
  campaign_id: string;
  kind: ExperimentKind;
  config: CreativeAbConfig | BudgetRampConfig;
}): Promise<AdExperiment> {
  return proxy("POST", `${ADS}/experiments`, body);
}

/** Move a draft experiment to running. Requires the campaign to be active. */
export function startExperiment(id: string): Promise<AdExperiment> {
  return proxy("POST", `${ADS}/experiments/${id}/start`);
}

/** Budget ramps only: compute + submit the next step through the governed
 *  safe-execute layer. Idempotent — safe to call repeatedly, including
 *  while a previous step awaits approval. Rejects with a 402 message when
 *  the spend guard refuses the step. */
export function advanceExperiment(id: string): Promise<AdExperiment> {
  return proxy("POST", `${ADS}/experiments/${id}/advance`);
}

/** Creative A/B only: attribute newly-synced metrics and pick a winner once
 *  the minimum window is met. Idempotent — safe to call repeatedly. */
export function evaluateExperiment(id: string): Promise<AdExperiment> {
  return proxy("POST", `${ADS}/experiments/${id}/evaluate`);
}

/** Cancel an experiment. Idempotent on an already-finished one. */
export function cancelExperiment(id: string): Promise<AdExperiment> {
  return proxy("POST", `${ADS}/experiments/${id}/cancel`);
}
