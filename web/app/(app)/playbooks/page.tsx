import { PlaybooksView } from "@/components/app/playbooks/playbooks-view";
import type { Niche, NichePerformance, TodaySpend } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Playbooks · Marketer" };

export default async function PlaybooksPage() {
  const [niches, spend] = await Promise.all([safe<Niche[]>("/api/v1/niches"), safe<TodaySpend>("/api/v1/spend/today")]);
  const perfs = await Promise.all((niches ?? []).map((n) => safe<NichePerformance>(`/api/v1/niches/${n.id}/performance?days=30`)));
  const performance = Object.fromEntries((niches ?? []).map((n, i) => [n.id, perfs[i]]));
  return <PlaybooksView niches={niches} performance={performance} spend={spend} />;
}
