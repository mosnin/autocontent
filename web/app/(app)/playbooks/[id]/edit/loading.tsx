import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="detail" title="Edit playbook" crumbs={[{ label: "Playbooks", href: "/playbooks" }, { label: "Edit" }]} width="md" />;
}
