import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="detail" title="Article" crumbs={[{ label: "SEO", href: "/seo" }, { label: "Article" }]} width="lg" />;
}
