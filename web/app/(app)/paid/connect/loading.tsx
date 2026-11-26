import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="column" title="Ad accounts" crumbs={[{ label: "Paid media", href: "/paid" }, { label: "Ad accounts" }]} width="md" />;
}
