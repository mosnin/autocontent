import { SeoView } from "@/components/app/seo/seo-view";
import type { ArticleBatch } from "@/lib/seo";
import type { Article, Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "SEO · Marketer" };

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const [articles, niches, batches] = await Promise.all([safe<Article[]>("/api/v1/articles?limit=100"), safe<Niche[]>("/api/v1/niches"), safe<ArticleBatch[]>("/api/v1/article-batches")]);
  return <SeoView articles={articles} niches={niches ?? []} batches={batches} openNew={sp.new === "1"} />;
}
