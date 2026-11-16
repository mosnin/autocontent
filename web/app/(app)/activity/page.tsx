import { ActivityView } from "@/components/mk/activity/activity-view";
import { getActivity } from "@/lib/workspace-server";

export const metadata = { title: "Activity · Marketer" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const activity = await getActivity(50, before || undefined);
  return <ActivityView activity={activity} before={before ?? null} />;
}
