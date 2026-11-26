import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="detail" title="Story video" crumbs={[{ label: "Content", href: "/content" }, { label: "Story videos", href: "/content/stories" }, { label: "Story video" }]} width="lg" />;
}
