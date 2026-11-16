import { Compass } from "lucide-react";
import { PlaybookDetailView } from "@/components/mk/playbooks/playbook-detail-view";
import { PageBody, PageHeader } from "@/components/mk/page";
import { ButtonLink, Empty } from "@/components/mk/ui";
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
        <PageBody width="3xl">
          <Empty art="search" title="Couldn't find that playbook" action={<ButtonLink href="/playbooks" variant="primary">All playbooks</ButtonLink>}>
            It may have been archived, or the API didn't answer.
          </Empty>
        </PageBody>
      </>
    );
  }
  return <PlaybookDetailView niche={niche} performance={performance} spendHistory={spendHistory} spend={spend} jobs={jobs} />;
}
