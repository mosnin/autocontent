import { api } from "@/lib/api";
import type { AdRun } from "@/lib/ad-creatives-client";
import type { Niche } from "@/lib/types";
import { AdCreativesClient } from "./AdCreativesClient";

export const dynamic = "force-dynamic";

export default async function AdCreativesPage() {
  // Both reads are optional context: the studio is config-gated and a
  // deployment without it still renders the (empty) studio rather than a
  // crash, exactly like ads/approvals.
  const [runs, niches] = await Promise.all([
    api<AdRun[]>("/api/v1/ad-creatives?limit=50").catch(() => [] as AdRun[]),
    api<Niche[]>("/api/v1/niches").catch(() => [] as Niche[]),
  ]);
  return <AdCreativesClient initialRuns={runs} niches={niches} />;
}
