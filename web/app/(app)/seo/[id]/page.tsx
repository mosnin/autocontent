import { FileText } from "lucide-react";
import { ArticleDetailView } from "@/components/app/seo/article-detail-view";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
import type { Article, Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Article · Marketer" };

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const article = await safe<Article>(`/api/v1/articles/${encodeURIComponent(id)}`);
  if (!article) {
    return (
      <>
        <PageHeader icon={<FileText />} title="Article" />
        <Column width="sm">
          <EmptyLine action={<ButtonLink href="/seo" variant="primary">Back to SEO</ButtonLink>}>Couldn&apos;t find that article. It may have been removed.</EmptyLine>
        </Column>
      </>
    );
  }
  const niche = await safe<Niche>(`/api/v1/niches/${article.niche_id}`);
  return <ArticleDetailView article={article} niche={niche} />;
}
