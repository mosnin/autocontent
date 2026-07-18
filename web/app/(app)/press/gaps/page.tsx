import { api } from "@/lib/api";
import type { GscGapsResponse } from "@/lib/press-analytics-client";
import { GapsClient } from "./GapsClient";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 90;

// Content gaps: queries Search Console sees impressions for that no
// existing article targets, candidates for a new topic.
export default async function GapsPage() {
  const gaps = await api<GscGapsResponse>(`/api/v1/gsc/gaps?days=${DEFAULT_DAYS}`);

  return <GapsClient initial={gaps} initialDays={DEFAULT_DAYS} />;
}
