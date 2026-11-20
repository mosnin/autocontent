import { type ActivityTab, ActivityView } from "@/components/app/activity/activity-view";
import { getActivity, getDecisions, getInbox } from "@/lib/workspace-server";

export const metadata = { title: "Activity · Marketer" };

const TABS: ActivityTab[] = ["needs", "all", "decisions"];

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ before?: string; tab?: string; focus?: string; cursor?: string }> }) {
  const { before, tab, focus, cursor } = await searchParams;
  const [activity, inbox, decisions] = await Promise.all([getActivity(50, before || undefined), getInbox(), getDecisions(50, cursor || undefined)]);
  return (
    <ActivityView
      activity={activity}
      inbox={inbox}
      decisions={decisions}
      before={before ?? null}
      cursor={cursor ?? null}
      focus={focus ?? null}
      initialTab={TABS.includes(tab as ActivityTab) ? (tab as ActivityTab) : undefined}
    />
  );
}
