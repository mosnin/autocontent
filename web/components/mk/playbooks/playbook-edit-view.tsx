import { Compass } from "lucide-react";
import Link from "next/link";
import type { Niche } from "@/lib/types";
import { Crumbs, PageBody, PageHeader, PageIntro } from "../page";
import { PlaybookEditor, type EditorCatalog } from "./playbook-editor";

export function PlaybookEditView({ niche, catalog }: { niche: Niche; catalog: EditorCatalog }) {
  return (
    <>
      <PageHeader
        icon={<Compass />}
        title={
          <Crumbs
            items={[
              <Link key="p" href="/playbooks" className="hover:text-foreground">
                Playbooks
              </Link>,
              <Link key="n" href={`/playbooks/${niche.id}`} className="hover:text-foreground">
                {niche.title}
              </Link>,
              "Edit",
            ]}
          />
        }
      />
      <PageBody width="3xl">
        <PageIntro title={`Edit ${niche.title}`}>Change anything and save. The next run picks up the new settings.</PageIntro>
        <PlaybookEditor mode="edit" niche={niche} catalog={catalog} cancelHref={`/playbooks/${niche.id}`} />
      </PageBody>
    </>
  );
}
