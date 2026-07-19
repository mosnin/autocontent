import { api } from "@/lib/api";
import type { Job } from "@/lib/types";
import { FailuresInbox } from "./FailuresInbox";
import { QueueClient } from "./QueueClient";

export const dynamic = "force-dynamic";

export default async function Queue() {
  const jobs = await api<Job[]>("/api/v1/jobs?limit=100");
  return (
    <div className="space-y-6">
      {/* Self-contained: fetches its own data client-side, so it can't
          break this server component's existing render if the failures
          endpoint is slow or briefly unavailable. */}
      <FailuresInbox />
      <QueueClient initial={jobs} />
    </div>
  );
}
