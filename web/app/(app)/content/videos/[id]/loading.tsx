import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="detail" title="Video" crumbs={[{ label: "Content", href: "/content" }, { label: "Video" }]} width="lg" />;
}
