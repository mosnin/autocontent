import { Compass } from "lucide-react";
import { PlaybookEditView } from "@/components/app/playbooks/playbook-edit-view";
import { ButtonLink, Column, EmptyLine, PageHeader } from "@/design-system";
import { getEditorCatalog } from "@/lib/playbook-catalog";
import type { Niche } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Edit playbook · Marketer" };

export default async function EditPlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [niche, catalog] = await Promise.all([safe<Niche>(`/api/v1/niches/${encodeURIComponent(id)}`), getEditorCatalog()]);
  if (!niche) {
    return (
      <>
        <PageHeader icon={<Compass />} title="Edit playbook" />
        <Column width="sm">
          <EmptyLine action={<ButtonLink href="/playbooks" variant="primary">All playbooks</ButtonLink>}>Couldn&apos;t find that playbook. It may have been archived.</EmptyLine>
        </Column>
      </>
    );
  }
  return <PlaybookEditView niche={niche} catalog={catalog} />;
}
