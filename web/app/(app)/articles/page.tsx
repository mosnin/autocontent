import { api } from "@/lib/api";
import type { Article, Niche } from "@/lib/types";
import { ArticlesClient } from "./ArticlesClient";

export const dynamic = "force-dynamic";

export default async function Articles() {
  const [articles, niches] = await Promise.all([
    api<Article[]>("/api/v1/articles?limit=100"),
    api<Niche[]>("/api/v1/niches"),
  ]);
  return <ArticlesClient initial={articles} niches={niches} />;
}
