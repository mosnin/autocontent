import { SeoView } from "@/components/mk/seo/seo-view";
import type { Article, Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "SEO · Marketer" };

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const [articles, niches] = await Promise.all([safe<Article[]>("/api/v1/articles?limit=100"), safe<Niche[]>("/api/v1/niches")]);
  return <SeoView articles={articles} niches={niches ?? []} openNew={sp.new === "1"} />;
}
