import { AdAccountsView } from "@/components/mk/paid/ad-accounts-view";
import type { AdAccount } from "@/lib/ads-client";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Ad accounts · Marketer" };

export default async function PaidConnectPage() {
  const accounts = await safe<AdAccount[]>("/api/v1/ads/accounts");
  return <AdAccountsView accounts={accounts ?? []} loadFailed={accounts === null} />;
}
