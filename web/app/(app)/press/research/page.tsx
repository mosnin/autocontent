import { api } from "@/lib/api";
import type { Article } from "@/lib/types";
import { ResearchClient } from "./ResearchClient";

export const dynamic = "force-dynamic";

// SERP research library: pick a done article and see the SERP analysis the
// pipeline's research stage cached for it.
export default async function ResearchPage() {
  const articles = await api<Article[]>("/api/v1/articles?status_filter=done&limit=200");

  return <ResearchClient articles={articles} />;
}
