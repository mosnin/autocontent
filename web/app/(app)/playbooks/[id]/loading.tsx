import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="detail" title="Playbook" crumbs={[{ label: "Playbooks", href: "/playbooks" }, { label: "Playbook" }]} width="lg" />;
}
