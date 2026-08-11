import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { AdCampaign, AdMetricsDaily } from "@/lib/ads-client";
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
  return <CampaignDetailClient initial={detail} />;
}
