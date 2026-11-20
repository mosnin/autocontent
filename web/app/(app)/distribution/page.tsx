import { DistributionView } from "@/components/app/distribution/distribution-view";
import type { CalendarItem } from "@/lib/business";
import type { AyrshareConnectStatus, Campaign, Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Distribution · Marketer" };

export default async function DistributionPage() {
  const [ayrshare, campaigns, calendar, niches] = await Promise.all([
    safe<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status"),
    safe<Campaign[]>("/api/v1/campaigns"),
    safe<CalendarItem[]>("/api/v1/calendar?days=7"),
    safe<Niche[]>("/api/v1/niches"),
  ]);
  return <DistributionView ayrshare={ayrshare} campaigns={campaigns} calendar={calendar} playbooks={(niches ?? []).map((n) => ({ id: n.id, title: n.title }))} />;
}
