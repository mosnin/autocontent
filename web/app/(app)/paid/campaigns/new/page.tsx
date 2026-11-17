import { NewCampaignView } from "@/components/app/paid/new-campaign-view";
import type { AdAccount } from "@/lib/ads-client";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "New campaign · Paid media · Marketer" };

export default async function NewPaidCampaignPage() {
  const accounts = await safe<AdAccount[]>("/api/v1/ads/accounts");
  return <NewCampaignView accounts={accounts ?? []} />;
}
