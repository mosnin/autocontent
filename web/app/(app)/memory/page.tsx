import { MemoryView } from "@/components/app/memory/memory-view";
import type { FactPage, MemoryLearning, RecallPage, RecallSettings } from "@/components/app/memory/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Memory · Marketer" };

export default async function MemoryPage() {
  // "active" = current facts plus the ones waiting for the person. History is fetched per fact, on demand.
  // Recall (Supermemory): the caller's own personal memories and, with memory:read, the workspace's. The backend
  // derives both namespaces from the session; nothing here names a person.
  const [facts, learnings, settings, personal, team] = await Promise.all([
    safe<FactPage>("/api/v1/memory/facts?state=active&limit=500"),
    safe<{ items: MemoryLearning[] }>("/api/v1/memory/learnings?limit=100"),
    safe<RecallSettings>("/api/v1/memory/recall/settings"),
    safe<RecallPage>("/api/v1/memory/personal?limit=100"),
    safe<RecallPage>("/api/v1/memory/team?limit=100"),
  ]);
  return <MemoryView facts={facts?.items ?? []} learnings={learnings?.items ?? []} recall={{ settings, personal, team }} loadFailed={facts === null} />;
}
