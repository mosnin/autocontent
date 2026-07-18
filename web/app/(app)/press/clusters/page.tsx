import { api } from "@/lib/api";
import type { Niche } from "@/lib/types";
import type { ContentCluster } from "@/lib/press-analytics-client";
import { ClustersClient } from "./ClustersClient";

export const dynamic = "force-dynamic";

// Content clusters: plan a pillar + spoke topic map for a channel around a
// keyword, then promote individual spokes into the topic approval queue.
export default async function ClustersPage() {
  const [clusters, niches] = await Promise.all([
    api<ContentCluster[]>("/api/v1/intelligence/clusters"),
    api<Niche[]>("/api/v1/niches"),
  ]);

  return <ClustersClient initial={clusters} niches={niches} />;
}
