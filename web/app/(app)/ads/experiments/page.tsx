import { api } from "@/lib/api";
import type { AdCampaign } from "@/lib/ads-client";
import { ExperimentsClient } from "./ExperimentsClient";

export const dynamic = "force-dynamic";

export default async function AdsExperimentsPage() {
  let campaigns: AdCampaign[] = [];
  try {
    campaigns = await api<AdCampaign[]>("/api/v1/ads/campaigns");
  } catch {
    campaigns = [];
  }
  return <ExperimentsClient campaigns={campaigns} />;
}
