import { api } from "@/lib/api";
import type { AdAccount } from "@/lib/ads-client";
import { NewCampaignClient } from "./NewCampaignClient";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  let accounts: AdAccount[] = [];
  try {
    accounts = await api<AdAccount[]>("/api/v1/ads/accounts");
  } catch {
    accounts = [];
  }
  return <NewCampaignClient accounts={accounts} />;
}
