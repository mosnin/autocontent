import { FileText } from "lucide-react";
import { ArticleDetailView } from "@/components/mk/seo/article-detail-view";
import { PageBody, PageHeader } from "@/components/mk/page";
import { ButtonLink, Empty } from "@/components/mk/ui";
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
        <PageBody width="3xl">
          <Empty art="search" title="Couldn't find that article" action={<ButtonLink href="/seo" variant="primary">Back to SEO</ButtonLink>}>
            It may have been removed, or the API didn't answer.
          </Empty>
        </PageBody>
      </>
    );
  }
  const niche = await safe<Niche>(`/api/v1/niches/${article.niche_id}`);
  return <ArticleDetailView article={article} niche={niche} />;
}
