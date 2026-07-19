import { api } from "@/lib/api";
import type { Campaign, Niche } from "@/lib/types";
import { CampaignsClient } from "./CampaignsClient";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const [campaigns, niches] = await Promise.all([
    api<Campaign[]>("/api/v1/campaigns"),
    api<Niche[]>("/api/v1/niches"),
  ]);
  return <CampaignsClient initial={campaigns} niches={niches} />;
}
