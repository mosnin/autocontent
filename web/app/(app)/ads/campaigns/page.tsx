import { api } from "@/lib/api";
import type { AdAccount, AdCampaign } from "@/lib/ads-client";
import { CampaignsClient } from "./CampaignsClient";

export const dynamic = "force-dynamic";

export default async function AdsCampaignsPage() {
  let campaigns: AdCampaign[] = [];
  let accounts: AdAccount[] = [];
  try {
    [campaigns, accounts] = await Promise.all([
      api<AdCampaign[]>("/api/v1/ads/campaigns"),
      api<AdAccount[]>("/api/v1/ads/accounts"),
    ]);
  } catch {
    campaigns = [];
    accounts = [];
  }
  const hasAccounts = accounts.some((a) => a.status !== "disconnected");
  return <CampaignsClient initial={campaigns} hasAccounts={hasAccounts} />;
}
