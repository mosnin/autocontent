import { TrackerHome } from "@/components/app/tracker/tracker-home";
import type { TemplateInfo, TrackerTableSummary } from "@/lib/tracker";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Tracker · Marketer" };

export default async function TrackerPage() {
  const [tables, templates] = await Promise.all([safe<TrackerTableSummary[]>("/api/v1/tracker/tables"), safe<TemplateInfo[]>("/api/v1/tracker/templates")]);
  return <TrackerHome tables={tables ?? []} templates={templates ?? []} loadError={tables === null} />;
}
