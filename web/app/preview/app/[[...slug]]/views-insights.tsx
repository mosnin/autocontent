// Preview views for the insights pages. key = path after /preview/app/.
import type { ReactNode } from "react";
import { ActivityView } from "@/components/app/activity/activity-view";
import { AnalyticsView } from "@/components/app/analytics/analytics-view";
import { LibraryView } from "@/components/app/library/library-view";
import { planWindow } from "@/components/app/plan/plan-data";
import { PlanView } from "@/components/app/plan/plan-view";
import {
  FIXTURE_ACTIVITY_FULL,
  FIXTURE_ANALYTICS,
  FIXTURE_CLIPS,
  FIXTURE_COMPOSITIONS,
  FIXTURE_DECISIONS,
  FIXTURE_FINALS,
  FIXTURE_IMAGE_POSTS,
  FIXTURE_IMAGES,
  FIXTURE_NICHES,
  FIXTURE_PLAN,
} from "@/lib/fixtures-insights";
import { PageSkeleton } from "@/design-system";
import { FIXTURE_INBOX } from "@/lib/fixtures";
import { EMPTY_INBOX } from "@/lib/workspace";

const today = () => new Date().toISOString().slice(0, 10);

function plan(mode: "week" | "month") {
  const w = planWindow(mode, 0, today());
  return <PlanView items={FIXTURE_PLAN} mode={mode} offset={0} start={w.start} days={w.days} anchor={w.anchor} />;
}

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  analytics: () => <AnalyticsView {...FIXTURE_ANALYTICS} />,
  "analytics/empty": () => <AnalyticsView {...FIXTURE_ANALYTICS} overview={null} />,
  activity: () => <ActivityView activity={FIXTURE_ACTIVITY_FULL} inbox={FIXTURE_INBOX} decisions={FIXTURE_DECISIONS} basePath="/preview/app/activity" />,
  "activity/all": () => <ActivityView activity={FIXTURE_ACTIVITY_FULL} inbox={FIXTURE_INBOX} decisions={FIXTURE_DECISIONS} basePath="/preview/app/activity" initialTab="all" />,
  "activity/decisions": () => <ActivityView activity={FIXTURE_ACTIVITY_FULL} inbox={FIXTURE_INBOX} decisions={FIXTURE_DECISIONS} basePath="/preview/app/activity" initialTab="decisions" />,
  // Decision models off: the log is empty, not broken.
  "activity/decisions/off": () => <ActivityView activity={FIXTURE_ACTIVITY_FULL} inbox={FIXTURE_INBOX} decisions={{ items: [], next_cursor: null }} basePath="/preview/app/activity" initialTab="decisions" />,
  "activity/empty": () => <ActivityView activity={{ events: [], next_before: null }} inbox={EMPTY_INBOX} decisions={{ items: [], next_cursor: null }} basePath="/preview/app/activity" />,
  // Every fetch failed: each tab says so in one line.
  "activity/error": () => <ActivityView activity={null} inbox={null} decisions={null} basePath="/preview/app/activity" initialTab="decisions" />,
  inbox: () => <ActivityView activity={FIXTURE_ACTIVITY_FULL} inbox={FIXTURE_INBOX} decisions={FIXTURE_DECISIONS} basePath="/preview/app/activity" initialTab="needs" focus={FIXTURE_INBOX.items[1]?.id ?? null} />,
  // What each route's loading.tsx renders, one per page template.
  "loading/column": () => <PageSkeleton template="column" title="Activity" />,
  "loading/tool": () => <PageSkeleton template="tool" title="Content" />,
  "loading/dashboard": () => <PageSkeleton template="dashboard" title="Analytics" />,
  "loading/detail": () => <PageSkeleton template="detail" title="Video" crumbs={[{ label: "Content", href: "/content" }, { label: "Video" }]} width="lg" />,
  "loading/chat": () => <PageSkeleton template="chat" title="Session" />,
  "loading/home": () => <PageSkeleton template="home" title="Home" />,
  plan: () => plan("week"),
  "plan/month": () => plan("month"),
  "plan/empty": () => {
    const w = planWindow("week", 0, today());
    return <PlanView items={[]} mode="week" offset={0} start={w.start} days={w.days} anchor={w.anchor} />;
  },
  library: () => (
    <LibraryView
      offline
      initialFinals={FIXTURE_FINALS}
      initialClips={FIXTURE_CLIPS}
      initialImages={FIXTURE_IMAGES}
      initialCompositions={FIXTURE_COMPOSITIONS}
      initialImagePosts={FIXTURE_IMAGE_POSTS}
      niches={FIXTURE_NICHES}
    />
  ),
};
