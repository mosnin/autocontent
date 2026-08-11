import { api } from "@/lib/api";
import type { MotionProject, MotionStyle } from "@/lib/motion-client";
import type { Job, Niche } from "@/lib/types";
import { MotionClient } from "./MotionClient";

export const dynamic = "force-dynamic";

export default async function MotionPage() {
  let styles: MotionStyle[] = [];
  try {
    styles = await api<MotionStyle[]>("/api/v1/motion/styles");
  } catch {
    styles = [];
  }

  let projects: MotionProject[] = [];
  try {
    projects = await api<MotionProject[]>("/api/v1/motion/projects?limit=50");
  } catch {
    projects = [];
  }

  let niches: Niche[] = [];
  try {
    niches = await api<Niche[]>("/api/v1/niches");
  } catch {
    niches = [];
  }

  // Finished jobs whose voiceover + transcript a project can reuse instead of
  // paying for TTS again. Purely optional, so a failure here is not fatal.
  let jobs: Job[] = [];
  try {
    jobs = await api<Job[]>("/api/v1/jobs?status_filter=done&limit=25");
  } catch {
    jobs = [];
  }

  return (
    <MotionClient
      initialProjects={projects}
      jobs={jobs}
      niches={niches}
      styles={styles}
    />
  );
}
