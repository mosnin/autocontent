import { api } from "@/lib/api";
import type { AdAccount, AdsOverview } from "@/lib/ads-client";
import { ConnectClient } from "./ConnectClient";

export const dynamic = "force-dynamic";

export default async function AdsConnectPage() {
  let initial: AdAccount[] = [];
  let adsEnabled: boolean | null = null;
  try {
    const [accounts, overview] = await Promise.all([
      api<AdAccount[]>("/api/v1/ads/accounts"),
      api<AdsOverview>("/api/v1/ads/overview"),
    ]);
    initial = accounts;
    adsEnabled = overview.ads_enabled;
  } catch {
    // Render with an empty list if the fetch fails (e.g. ads not enabled).
    initial = [];
  }
  return <ConnectClient adsEnabled={adsEnabled} initial={initial} />;
}
