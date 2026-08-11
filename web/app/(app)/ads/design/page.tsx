import { api } from "@/lib/api";
import type { DesignProject } from "@/lib/design-client";
import type { Niche } from "@/lib/types";
import { DesignClient } from "./DesignClient";

export const dynamic = "force-dynamic";

export default async function DesignAgentPage() {
  // A design project is niche-scoped (spend rides on the niche), so the
  // composer needs the niche list. Either read may legitimately fail on an
  // unconfigured deployment — fall back to empty and let the client render
  // its calm empty state.
  const [projects, niches] = await Promise.all([
    api<DesignProject[]>("/api/v1/design/projects?limit=50").catch(
      () => [] as DesignProject[],
    ),
    api<Niche[]>("/api/v1/niches").catch(() => [] as Niche[]),
  ]);
  return <DesignClient initialProjects={projects} niches={niches} />;
}
