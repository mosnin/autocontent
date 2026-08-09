import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { MotionProject, MotionStyle } from "@/lib/motion-client";
import { MotionDetailClient } from "./MotionDetailClient";

export const dynamic = "force-dynamic";

export default async function MotionProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let project: MotionProject;
  try {
    project = await api<MotionProject>(`/api/v1/motion/projects/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Another user's project is a 404, never a 403, so ids can't be probed.
    if (msg.startsWith("404") || msg.startsWith("422")) notFound();
    throw e;
  }

  // The style catalog is static content that ships with the app; used only to
  // label the project, so a failure degrades to the raw style key.
  let styles: MotionStyle[] = [];
  try {
    styles = await api<MotionStyle[]>("/api/v1/motion/styles");
  } catch {
    styles = [];
  }

  return <MotionDetailClient id={id} initial={project} styles={styles} />;
}
