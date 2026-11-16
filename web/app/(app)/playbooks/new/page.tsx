import { PlaybookNewView } from "@/components/mk/playbooks/playbook-new-view";
import { getEditorCatalog } from "@/lib/playbook-catalog";

export const metadata = { title: "New playbook · Marketer" };

export default async function NewPlaybookPage() {
  return <PlaybookNewView catalog={await getEditorCatalog()} />;
}
