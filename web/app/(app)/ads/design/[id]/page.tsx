import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { DesignProject } from "@/lib/design-client";
import { DesignProjectClient } from "./DesignProjectClient";

export const dynamic = "force-dynamic";

export default async function DesignProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let project: DesignProject;
  try {
    project = await api<DesignProject>(`/api/v1/design/projects/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) notFound();
    throw e;
  }
  return <DesignProjectClient initial={project} />;
}
