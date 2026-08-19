import { api } from "@/lib/api";
import type { AdCampaign } from "@/lib/ads-client";
import type { CampaignOverview, Niche } from "@/lib/types";
import { CampaignDetailClient } from "./CampaignDetailClient";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [overview, niches] = await Promise.all([
    api<CampaignOverview>(`/api/v1/campaigns/${id}`),
    api<Niche[]>("/api/v1/niches"),
  ]);
  // Best-effort: the ad-campaign picker degrades to empty when Ads is off.
  let adCampaigns: AdCampaign[] = [];
  try {
    adCampaigns = await api<AdCampaign[]>("/api/v1/ads/campaigns");
  } catch {
    adCampaigns = [];
  }
  return (
    <CampaignDetailClient adCampaigns={adCampaigns} initial={overview} niches={niches} />
  );
}
