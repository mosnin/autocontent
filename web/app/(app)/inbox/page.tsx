import { ActivityView } from "@/components/app/activity/activity-view";
import { getActivity, getInbox } from "@/lib/workspace-server";

export const metadata = { title: "Inbox · Marketer" };

/** The inbox is Activity opened on "Needs you". */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  const [activity, inbox] = await Promise.all([getActivity(50), getInbox()]);
  return <ActivityView activity={activity} inbox={inbox} focus={focus ?? null} initialTab="needs" />;
}
