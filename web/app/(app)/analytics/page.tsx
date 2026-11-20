import { type AnalyticsData, AnalyticsView, type MetricsSummary } from "@/components/app/analytics/analytics-view";
import { parsePeriod } from "@/components/app/analytics/period";
import type { AdsOverview } from "@/lib/ads-client";
import type { Niche, NichePerformance, SpendHistory } from "@/lib/types";
import { getOverview, safe } from "@/lib/workspace-server";

export const metadata = { title: "Analytics · Marketer" };

const MAX_PLAYBOOKS = 8;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; compare?: string }> }) {
  const sp = await searchParams;
  const days = parsePeriod(sp.days);
  const [overview, doubled, spend, ads, metrics, niches] = await Promise.all([
    getOverview(days),
    getOverview(days * 2),
    safe<SpendHistory>(`/api/v1/spend/history?days=${days}`),
    safe<AdsOverview>("/api/v1/ads/overview"),
    safe<MetricsSummary>("/api/v1/metrics/summary"),
    safe<Niche[]>("/api/v1/niches"),
  ]);
  const live = (niches ?? []).filter((n) => !n.archived_at).slice(0, MAX_PLAYBOOKS);
  const perf = await Promise.all(live.map((n) => safe<NichePerformance>(`/api/v1/niches/${n.id}/performance?days=${days}`)));

  const data: AnalyticsData = {
    days,
    compare: sp.compare !== "off",
    overview,
    previousSeries: doubled && doubled.series.length === days * 2 ? doubled.series.slice(0, days) : null,
    spend,
    ads,
    metrics,
    playbooks: [
      ...live.map((n, i) => ({ id: n.id, title: n.title, summary: perf[i]?.summary ?? null })),
      // Archived playbooks still name their past spend.
      ...(niches ?? []).filter((n) => n.archived_at).map((n) => ({ id: n.id, title: n.title, summary: null })),
    ],
  };
  return <AnalyticsView {...data} />;
}
