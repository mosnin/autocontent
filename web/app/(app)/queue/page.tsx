import { api } from "@/lib/api";
import type { Job, Niche } from "@/lib/types";
import { FailuresInbox } from "./FailuresInbox";
import { QueueClient } from "./QueueClient";

export const dynamic = "force-dynamic";

export default async function Queue() {
  const [jobs, niches] = await Promise.all([
    api<Job[]>("/api/v1/jobs?limit=100"),
    api<Niche[]>("/api/v1/niches"),
  ]);
  // Real niche_id -> title lookup for the queue table's "Niche" column —
  // jobs only carry niche_id, so we resolve titles once server-side
  // instead of fetching per-row or fabricating labels.
  const nicheTitles = Object.fromEntries(niches.map((n) => [n.id, n.title]));

  return (
    <div className="space-y-6">
      {/* Self-contained: fetches its own data client-side, so it can't
          break this server component's existing render if the failures
          endpoint is slow or briefly unavailable. */}
      <FailuresInbox />
      <QueueClient initial={jobs} nicheTitles={nicheTitles} />
    </div>
  );
}
