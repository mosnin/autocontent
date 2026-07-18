import { api } from "@/lib/api";
import type { Niche, TopicProposal } from "@/lib/types";
import { TopicsClient } from "./TopicsClient";

export const dynamic = "force-dynamic";

// The approval loop: generate candidate topics for a channel, then approve
// or reject them. Approved topics feed the autopilot scheduler directly.
export default async function TopicsPage() {
  const [topics, niches] = await Promise.all([
    api<TopicProposal[]>("/api/v1/press/topics?limit=200"),
    api<Niche[]>("/api/v1/niches"),
  ]);

  return <TopicsClient initial={topics} niches={niches} />;
}
