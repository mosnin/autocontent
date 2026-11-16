import { Compass } from "lucide-react";
import { PlaybookEditView } from "@/components/mk/playbooks/playbook-edit-view";
import { PageBody, PageHeader } from "@/components/mk/page";
import { ButtonLink, Empty } from "@/components/mk/ui";
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
        <PageBody width="3xl">
          <Empty art="search" title="Couldn't find that playbook" action={<ButtonLink href="/playbooks" variant="primary">All playbooks</ButtonLink>}>
            It may have been archived, or the API didn't answer.
          </Empty>
        </PageBody>
      </>
    );
  }
  return <PlaybookEditView niche={niche} catalog={catalog} />;
}
