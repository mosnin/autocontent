import { api } from "@/lib/api";
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
  return <CampaignDetailClient initial={overview} niches={niches} />;
}
