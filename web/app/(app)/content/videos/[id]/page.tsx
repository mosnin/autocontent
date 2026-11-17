import { Clapperboard } from "lucide-react";
import { VideoDetailView } from "@/components/app/content/video-detail-view";
import type { JobMetrics } from "@/components/app/content/types";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
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
        <Column width="sm">
          <EmptyLine action={<ButtonLink href="/content" variant="primary">Back to Content</ButtonLink>}>Couldn&apos;t find that video. It may have been removed.</EmptyLine>
        </Column>
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
