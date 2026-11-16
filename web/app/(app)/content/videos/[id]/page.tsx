import { Clapperboard } from "lucide-react";
import { VideoDetailView } from "@/components/mk/content/video-detail-view";
import type { JobMetrics } from "@/components/mk/content/types";
import { PageBody, PageHeader } from "@/components/mk/page";
import { ButtonLink, Empty } from "@/components/mk/ui";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import type { Job, Niche, NichePerformance } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Video · Marketer" };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await safe<Job>(`/api/v1/jobs/${encodeURIComponent(id)}`);
  if (!job) {
    return (
      <>
        <PageHeader icon={<Clapperboard />} title="Video" />
        <PageBody width="3xl">
          <Empty art="search" title="Couldn't find that video" action={<ButtonLink href="/content" variant="primary">Back to Content</ButtonLink>}>
            It may have been removed, or the API didn't answer.
          </Empty>
        </PageBody>
      </>
    );
  }
  const [niche, metrics, perf] = await Promise.all([
    safe<Niche>(`/api/v1/niches/${job.niche_id}`),
    safe<JobMetrics>(`/api/v1/jobs/${job.id}/metrics`),
    safe<NichePerformance>(`/api/v1/niches/${job.niche_id}/performance?days=90`),
  ]);
  const cost = perf?.jobs.find((j) => j.job_id === job.id)?.cost_usd ?? null;
  return <VideoDetailView job={job} niche={niche} metrics={metrics} costUsd={cost} estimate={niche ? estimateVideoCostUsd(niche) : null} />;
}
