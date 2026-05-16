import { notFound } from "next/navigation";

import { api } from "../../../lib/api";
import type { Job } from "../../../lib/types";
import { JobDetailClient } from "./JobDetailClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params;
  let job: Job;
  try {
    job = await api<Job>(`/api/v1/jobs/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) notFound();
    throw e;
  }
  return <JobDetailClient initial={job} />;
}
