import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="column" title="Story video" crumbs={[{ label: "Content", href: "/content" }, { label: "Story videos" }]} />;
}
