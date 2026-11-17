import { Column, PageHeader } from "@/design-system";
import type { Niche } from "@/lib/types";
import { toolGlyph } from "../content/shared";
import { PlaybookEditor, type EditorCatalog } from "./playbook-editor";

/** Edit a playbook (Column md): every field in sections, saved together. */
export function PlaybookEditView({ niche, catalog }: { niche: Niche; catalog: EditorCatalog }) {
  return (
    <>
      <PageHeader
        icon={toolGlyph("strategy")}
        crumbs={[
          { label: "Playbooks", href: "/playbooks" },
          { label: niche.title, href: `/playbooks/${niche.id}` },
          { label: "Edit" },
        ]}
      />
      <Column width="md" title={`Edit ${niche.title}`} description="The next run uses the new settings.">
        <PlaybookEditor mode="edit" niche={niche} catalog={catalog} cancelHref={`/playbooks/${niche.id}`} />
      </Column>
    </>
  );
}
