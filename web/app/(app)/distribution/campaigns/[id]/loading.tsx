import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="detail" title="Campaign" crumbs={[{ label: "Distribution", href: "/distribution" }, { label: "Campaign" }]} width="lg" />;
}
