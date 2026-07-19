import { api } from "@/lib/api";
import type { AdsOverview } from "@/lib/ads-client";
import { AdsOverviewShell } from "./AdsOverviewShell";

export const dynamic = "force-dynamic";

export default async function AdsOverviewPage() {
  let ov: AdsOverview | null = null;
  try {
    ov = await api<AdsOverview>("/api/v1/ads/overview");
  } catch {
    ov = null;
  }

  return <AdsOverviewShell ov={ov} />;
}
