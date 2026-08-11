import { notFound } from "next/navigation";

import { api } from "@/lib/api";
import type { Article, Niche } from "@/lib/types";
import { ArticleDetailClient } from "./ArticleDetailClient";

export const dynamic = "force-dynamic";

async function fetchArticle(id: string): Promise<Article | null> {
  try {
    return await api<Article>(`/api/v1/articles/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) return null;
    throw e;
  }
}

async function fetchNiche(id: string): Promise<Niche | null> {
  try {
    return await api<Niche>(`/api/v1/niches/${id}`);
  } catch {
    return null;
  }
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await fetchArticle(id);
  if (!article) notFound();

  const niche = await fetchNiche(article.niche_id);

  return (
    <ArticleDetailClient initial={article} nicheTitle={niche?.title ?? null} />
  );
}
