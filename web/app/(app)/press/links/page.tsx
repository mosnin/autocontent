import { api } from "@/lib/api";
import type { LinkOpportunity } from "@/lib/types";
import { LinksClient } from "./LinksClient";

export const dynamic = "force-dynamic";

// Cross-corpus internal-link opportunities: every finished article's stored
// link suggestions, filtered down to targets that still exist.
export default async function LinksPage() {
  const opportunities = await api<LinkOpportunity[]>("/api/v1/press/links");

  return <LinksClient opportunities={opportunities} />;
}
