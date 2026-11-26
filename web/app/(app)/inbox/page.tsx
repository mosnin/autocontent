import { ActivityView } from "@/components/app/activity/activity-view";
import { getActivity, getDecisions, getInbox } from "@/lib/workspace-server";

export const metadata = { title: "Inbox · Marketer" };

/** The inbox is Activity opened on "Needs you". */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  const [activity, inbox, decisions] = await Promise.all([getActivity(50), getInbox(), getDecisions(50)]);
  return <ActivityView activity={activity} inbox={inbox} decisions={decisions} focus={focus ?? null} initialTab="needs" />;
}
