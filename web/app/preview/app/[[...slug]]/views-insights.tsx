// Preview views for the insights pages. key = path after /preview/app/.
import type { ReactNode } from "react";
import { ActivityView } from "@/components/mk/activity/activity-view";
import { AnalyticsView } from "@/components/mk/analytics/analytics-view";
import { LibraryView } from "@/components/mk/library/library-view";
import { planWindow } from "@/components/mk/plan/plan-data";
import { PlanView } from "@/components/mk/plan/plan-view";
import {
  FIXTURE_ACTIVITY_FULL,
  FIXTURE_ANALYTICS,
  FIXTURE_CLIPS,
  FIXTURE_COMPOSITIONS,
  FIXTURE_FINALS,
  FIXTURE_IMAGE_POSTS,
  FIXTURE_IMAGES,
  FIXTURE_NICHES,
  FIXTURE_PLAN,
} from "@/lib/fixtures-insights";

const today = () => new Date().toISOString().slice(0, 10);

function plan(mode: "week" | "month") {
  const w = planWindow(mode, 0, today());
  return <PlanView items={FIXTURE_PLAN} mode={mode} offset={0} start={w.start} days={w.days} anchor={w.anchor} />;
}

export const VIEWS: Record<string, () => Promise<ReactNode> | ReactNode> = {
  analytics: () => <AnalyticsView {...FIXTURE_ANALYTICS} />,
  "analytics/empty": () => <AnalyticsView {...FIXTURE_ANALYTICS} overview={null} />,
  activity: () => <ActivityView activity={FIXTURE_ACTIVITY_FULL} basePath="/preview/app/activity" />,
  "activity/empty": () => <ActivityView activity={{ events: [], next_before: null }} basePath="/preview/app/activity" />,
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
