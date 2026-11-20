import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="column" title="New playbook" crumbs={[{ label: "Playbooks", href: "/playbooks" }, { label: "New" }]} width="md" />;
}
