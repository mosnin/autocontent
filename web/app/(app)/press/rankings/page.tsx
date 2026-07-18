import { api } from "@/lib/api";
import type { GscRankingsResponse } from "@/lib/press-analytics-client";
import { RankingsClient } from "./RankingsClient";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 28;

// Search Console top queries: clicks, impressions, average position, and
// the position trend vs. the prior window of equal length.
export default async function RankingsPage() {
  const rankings = await api<GscRankingsResponse>(
    `/api/v1/gsc/rankings?days=${DEFAULT_DAYS}`,
  );

  return <RankingsClient initial={rankings} initialDays={DEFAULT_DAYS} />;
}
