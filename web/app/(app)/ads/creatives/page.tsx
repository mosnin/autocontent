import { api } from "@/lib/api";
import type { AdCampaign } from "@/lib/ads-client";
import { CreativesClient } from "./CreativesClient";

export const dynamic = "force-dynamic";

export default async function AdsCreativesPage() {
  let campaigns: AdCampaign[] = [];
  try {
    campaigns = await api<AdCampaign[]>("/api/v1/ads/campaigns");
  } catch {
    campaigns = [];
  }
  return <CreativesClient campaigns={campaigns} />;
}
