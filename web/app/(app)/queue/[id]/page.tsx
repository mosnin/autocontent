import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import { estimateVideoCostUsd } from "@/lib/cost-estimator";
import type { Job, Niche, PostMetrics } from "@/lib/types";
import { JobDetailClient } from "./JobDetailClient";

export const dynamic = "force-dynamic";

async function fetchJob(id: string): Promise<Job | null> {
  try {
    return await api<Job>(`/api/v1/jobs/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) return null;
    throw e;
  }
}

async function fetchNiche(id: string): Promise<Niche | null> {
  try {
    return await api<Niche>(`/api/v1/niches/${id}`);
  } catch {
    return null;
  }
}

async function fetchJobMetrics(
  jobId: string,
): Promise<{ latest: PostMetrics | null; history: PostMetrics[] } | null> {
  try {
    return await api<{ latest: PostMetrics | null; history: PostMetrics[] }>(
      `/api/v1/jobs/${jobId}/metrics`,
    );
  } catch (e) {
    // 404 = endpoint not deployed yet (parallel PR); render empty state.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404") || msg.startsWith("422")) return null;
    throw e;
  }
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await fetchJob(id);
  if (!job) notFound();

  const [niche, jobMetrics] = await Promise.all([
    fetchNiche(job.niche_id),
    fetchJobMetrics(id),
  ]);

  // Cost breakdown depends only on the niche's static config, so it's
  // computed once server-side and passed as a fixed prop — the client
  // only re-polls the job itself.
  const breakdown = niche
    ? estimateVideoCostUsd({
        scene_count: niche.scene_count,
        image_quality: niche.image_quality,
        video_resolution: niche.video_resolution,
        scene_max_duration_sec: niche.scene_max_duration_sec,
        target_duration_sec: niche.target_duration_sec,
      })
    : null;

  return (
    <JobDetailClient
      initial={job}
      nicheTitle={niche?.title ?? null}
      breakdown={breakdown}
      jobMetrics={jobMetrics}
    />
  );
}
