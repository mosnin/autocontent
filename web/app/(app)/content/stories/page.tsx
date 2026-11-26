import { StoriesView } from "@/components/app/stories/stories-view";
import type { StorySummary } from "@/components/app/stories/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Story videos · Marketer" };

export default async function StoriesPage() {
  const stories = await safe<StorySummary[]>("/api/v1/stories?limit=50");
  return <StoriesView stories={stories} />;
}
