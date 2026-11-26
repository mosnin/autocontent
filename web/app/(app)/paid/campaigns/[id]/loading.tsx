import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="detail" title="Campaign" crumbs={[{ label: "Paid media", href: "/paid" }, { label: "Campaign" }]} width="lg" />;
}
