import { api } from "@/lib/api";
import type { Niche } from "@/lib/types";
import type { Competitor, PerformanceAlert } from "@/lib/press-analytics-client";
import { CompetitorsClient } from "./CompetitorsClient";

export const dynamic = "force-dynamic";

// Competitor tracking: watch a domain's recent articles and surface
// performance alerts (competitor activity, ranking drops, cadence slips,
// quality drops) in one inbox.
export default async function CompetitorsPage() {
  const [competitors, alerts, niches] = await Promise.all([
    api<Competitor[]>("/api/v1/competitors"),
    api<PerformanceAlert[]>("/api/v1/competitors/alerts?acknowledged=false"),
    api<Niche[]>("/api/v1/niches"),
  ]);

  return <CompetitorsClient initialCompetitors={competitors} initialAlerts={alerts} niches={niches} />;
}
