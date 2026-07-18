import { api } from "@/lib/api";
import type { PerformanceAlert } from "@/lib/press-analytics-client";
import { AlertsClient } from "./AlertsClient";

export const dynamic = "force-dynamic";

// Focused alerts inbox: every performance_alerts row (competitor activity,
// ranking drops, cadence slips, quality drops), filterable by kind and
// severity, with acknowledge in place.
export default async function AlertsPage() {
  const alerts = await api<PerformanceAlert[]>("/api/v1/competitors/alerts");

  return <AlertsClient initial={alerts} />;
}
