import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { AdAccount, AdCampaign, AdMetricsDaily } from "@/lib/ads-client";
import { CampaignDetailClient } from "./CampaignDetailClient";

export const dynamic = "force-dynamic";

interface Detail {
  campaign: AdCampaign;
  metrics: AdMetricsDaily[];
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let detail: Detail;
  try {
    detail = await api<Detail>(`/api/v1/ads/campaigns/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) notFound();
    throw e;
  }
  // The account whose guardrails govern this campaign — shown next to the
  // budget form so "over your account caps" cites numbers you can see.
  let account: AdAccount | null = null;
  try {
    const accounts = await api<AdAccount[]>("/api/v1/ads/accounts");
    account = accounts.find((a) => a.id === detail.campaign.ad_account_id) ?? null;
  } catch {
    account = null;
  }
  return <CampaignDetailClient account={account} initial={detail} />;
}
