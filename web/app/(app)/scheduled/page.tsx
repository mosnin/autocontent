import { api } from "@/lib/api";
import type { RecurringSlot, ScheduledPost } from "@/lib/scheduled-client";
import { ScheduledClient } from "./ScheduledClient";

export const dynamic = "force-dynamic";

export default async function ScheduledPosts() {
  // Settled independently: recurring slots are a side panel, so a failure
  // there must not cost the user the calendar itself. Both fall back to
  // empty rather than throwing — an unconfigured deployment answers 409,
  // and an empty calendar is the honest rendering of that.
  const [posts, slots] = await Promise.all([
    api<ScheduledPost[]>("/api/v1/scheduled-posts?limit=200").catch(() => []),
    api<RecurringSlot[]>("/api/v1/scheduled-posts/recurring").catch(() => []),
  ]);

  return <ScheduledClient initialPosts={posts} initialSlots={slots} />;
}
