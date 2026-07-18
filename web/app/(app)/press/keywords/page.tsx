import { api } from "@/lib/api";
import type { Niche } from "@/lib/types";
import type { KeywordCandidate } from "@/lib/press-analytics-client";
import { KeywordsClient } from "./KeywordsClient";

export const dynamic = "force-dynamic";

// Keyword research backlog: harvest candidate keywords for a channel, score
// their SERP difficulty, then track/dismiss/promote them into the topic
// approval queue.
export default async function KeywordsPage() {
  const [candidates, niches] = await Promise.all([
    api<KeywordCandidate[]>("/api/v1/keywords?limit=200"),
    api<Niche[]>("/api/v1/niches"),
  ]);

  return <KeywordsClient initial={candidates} niches={niches} />;
}
