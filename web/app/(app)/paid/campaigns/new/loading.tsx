import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="column" title="New campaign" crumbs={[{ label: "Paid media", href: "/paid" }, { label: "New campaign" }]} width="md" />;
}
