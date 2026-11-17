import { ContentView, type ContentTab } from "@/components/app/content/content-view";
import type { VideoFilter } from "@/components/app/content/status";
import type { Failures, MetricsSummary, Template } from "@/components/app/content/types";
import type { AyrshareConnectStatus, ImagePost, Job, Niche, TodaySpend, User } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Content · Marketer" };

const TABS: ContentTab[] = ["videos", "carousels", "templates"];
const FILTERS: VideoFilter[] = ["all", "awaiting", "in_progress", "done", "failed"];

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ tab?: string; status_filter?: string }> }) {
  const sp = await searchParams;
  const [jobs, niches, imagePosts, templates, spend, failures, metrics, ayrshare, user] = await Promise.all([
    safe<Job[]>("/api/v1/jobs?limit=200"),
    safe<Niche[]>("/api/v1/niches"),
    safe<ImagePost[]>("/api/v1/image-posts?limit=100"),
    safe<Template[]>("/api/v1/templates"),
    safe<TodaySpend>("/api/v1/spend/today"),
    safe<Failures>("/api/v1/failures?limit=100"),
    safe<MetricsSummary>("/api/v1/metrics/summary"),
    safe<AyrshareConnectStatus>("/api/v1/connect/ayrshare/status"),
    safe<User>("/api/v1/users/me"),
  ]);
  const tab = TABS.includes(sp.tab as ContentTab) ? (sp.tab as ContentTab) : "videos";
  const filter = FILTERS.includes(sp.status_filter as VideoFilter) ? (sp.status_filter as VideoFilter) : "all";
  return (
    <ContentView
      tab={tab}
      filter={filter}
      data={{
        jobs,
        niches: niches ?? [],
        imagePosts,
        templates,
        spend,
        failures,
        metrics,
        channelsConnected: ayrshare ? ayrshare.connected : null,
        globalCap: user?.global_daily_cap_usd ?? null,
      }}
    />
  );
}
