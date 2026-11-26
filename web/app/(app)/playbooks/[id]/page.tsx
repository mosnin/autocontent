import { Compass } from "lucide-react";
import { PlaybookDetailView } from "@/components/app/playbooks/playbook-detail-view";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
import type { Job, Niche, NichePerformance, SpendHistory, TodaySpend } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Playbook · Marketer" };

export default async function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = encodeURIComponent(id);
  const [niche, performance, spendHistory, spend, jobs] = await Promise.all([
    safe<Niche>(`/api/v1/niches/${nid}`),
    safe<NichePerformance>(`/api/v1/niches/${nid}/performance?days=30`),
    safe<SpendHistory>(`/api/v1/spend/history?days=30&niche_id=${nid}`),
    safe<TodaySpend>("/api/v1/spend/today"),
    safe<Job[]>(`/api/v1/jobs?niche_id=${nid}&limit=20`),
  ]);
  if (!niche) {
    return (
      <>
        <PageHeader icon={<Compass />} title="Playbook" />
        <Column width="sm">
          <EmptyLine action={<ButtonLink href="/playbooks" variant="primary">All playbooks</ButtonLink>}>Couldn&apos;t find that playbook. It may have been archived.</EmptyLine>
        </Column>
      </>
    );
  }
  return <PlaybookDetailView niche={niche} performance={performance} spendHistory={spendHistory} spend={spend} jobs={jobs} />;
}
