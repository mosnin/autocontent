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

export const adsKeys = {
  overview: () => `${ADS}/overview`,
  accounts: () => `${ADS}/accounts`,
  approvals: (status?: string) =>
    `${ADS}/approvals${status ? `?status_filter=${status}` : ""}`,
  actions: () => `${ADS}/actions`,
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
