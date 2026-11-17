import { ActivityView } from "@/components/app/activity/activity-view";
import { getActivity, getInbox } from "@/lib/workspace-server";

export const metadata = { title: "Activity · Marketer" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ before?: string; tab?: string; focus?: string }> }) {
  const { before, tab, focus } = await searchParams;
  const [activity, inbox] = await Promise.all([getActivity(50, before || undefined), getInbox()]);
  return <ActivityView activity={activity} inbox={inbox} before={before ?? null} focus={focus ?? null} initialTab={tab === "all" ? "all" : tab === "needs" ? "needs" : undefined} />;
}
