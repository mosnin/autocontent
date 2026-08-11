import { api } from "@/lib/api";
import type { AdAccount } from "@/lib/ads-client";
import { ConnectClient } from "./ConnectClient";

export const dynamic = "force-dynamic";

export default async function AdsConnectPage() {
  let initial: AdAccount[] = [];
  try {
    initial = await api<AdAccount[]>("/api/v1/ads/accounts");
  } catch {
    // Render with an empty list if the fetch fails (e.g. ads not enabled).
    initial = [];
  }
  return <ConnectClient initial={initial} />;
}
