import { MemoryView } from "@/components/app/memory/memory-view";
import type { FactPage, MemoryLearning } from "@/components/app/memory/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Memory · Marketer" };

export default async function MemoryPage() {
  // "active" = current facts plus the ones waiting for the person. History is fetched per fact, on demand.
  const [facts, learnings] = await Promise.all([safe<FactPage>("/api/v1/memory/facts?state=active&limit=500"), safe<{ items: MemoryLearning[] }>("/api/v1/memory/learnings?limit=100")]);
  return <MemoryView facts={facts?.items ?? []} learnings={learnings?.items ?? []} loadFailed={facts === null} />;
}
