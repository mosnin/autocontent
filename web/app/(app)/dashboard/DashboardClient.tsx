"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Coins, Eye, MoreHorizontal, Users, WalletMinimal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DashHeading,
  DashPanel,
  DashRise,
} from "@/components/hub/dashboard-kit";
import {
  HoverLift,
  hubCardClass,
  hubCardHoverClass,
} from "@/components/hub/primitives";
import { SquareStatsCards } from "@/components/square/stats-cards";
import {
  MonthlyViewsChart,
  type ChartPoint,
  type Period,
} from "@/components/square/monthly-views-chart";
import {
  RecentUploads,
  type RecentUpload,
} from "@/components/square/recent-uploads";
import { useRunConfirm } from "@/components/run-confirm-dialog";
import { archiveNicheAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Job, Niche, Platform, TodaySpend } from "@/lib/types";

interface InitialData {
  niches: Niche[];
  spend: TodaySpend;
  ayrshareConnected: boolean | null;
  globalCap: string | null;
}

const POLL_MS = 5000;

const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

export function DashboardClient({ initial }: { initial: InitialData }) {
  const { data: niches, error: nichesError, mutate: mutateNiches } = useSWR<Niche[]>(
    "/api/v1/niches",
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial.niches },
  );
  const { data: spend, error: spendError } = useSWR<TodaySpend>(
    "/api/v1/spend/today",
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial.spend },
  );
  const globalCap = initial.globalCap;
  const { data: metricsSummary } = useSWR<{
    total_views: number;
    sampled_videos: number;
  }>("/api/v1/metrics/summary", clientFetch, { refreshInterval: 60000 });

  // Finished jobs — same endpoint/pattern as latest-videos.tsx; feeds the
  // template's chart + recent-uploads tiles with real data.
  const { data: doneJobs } = useSWR<Job[]>(
    "/api/v1/jobs?status_filter=done&limit=250",
    clientFetch,
    { refreshInterval: 15000 },
  );

  // Probe Ayrshare status only when the parent told us the route exists
  // (initial.ayrshareConnected !== null).
  const { data: ayrshare } = useSWR<{ connected: boolean }>(
    initial.ayrshareConnected === null ? null : "/api/v1/connect/ayrshare/status",
    clientFetch,
    {
      refreshInterval: POLL_MS,
      fallbackData:
        initial.ayrshareConnected === null
          ? undefined
          : { connected: initial.ayrshareConnected },
      shouldRetryOnError: false,
    },
  );

  // Track whether a SWR error toast has already been shown for the
  // current error sequence so we don't spam on every poll tick.
  const errorToastedRef = React.useRef(false);
  const hasError = !!(nichesError || spendError);

  React.useEffect(() => {
    if (hasError && !errorToastedRef.current) {
      errorToastedRef.current = true;
      const msg =
        (nichesError ?? spendError)?.message ?? "fetch failed";
      toast.error(`Live updates paused: ${msg}`);
    }
    if (!hasError) {
      errorToastedRef.current = false;
    }
  }, [hasError, nichesError, spendError]);

  const nichesList = niches ?? [];
  const spendData = spend ?? { by_niche: {}, total_usd: "0" };
  const showAyrshareBanner =
    ayrshare !== undefined && ayrshare.connected === false;

  async function handleArchive(niche: Niche) {
    if (!confirm(`Archive niche "${niche.title}"? This will stop new posts.`)) {
      return;
    }

    // Optimistically remove the niche from the list.
    const prevNiches = niches ?? [];
    void mutateNiches(
      prevNiches.filter((n) => n.id !== niche.id),
      false,
    );

    const fd = new FormData();
    fd.set("niche_id", niche.id);
    const res = await archiveNicheAction({ ok: false }, fd);

    if (res.ok) {
      toast.success(`Archived ${niche.title}`);
      // Revalidate to sync server truth.
      void mutateNiches();
    } else {
      // Revert optimistic update.
      void mutateNiches(prevNiches, false);
      toast.error(res.error ?? "Archive failed");
    }
  }

  return (
    <div className="space-y-10">
      <DashHeading as="h1" sub="Every niche is a self-driving pipeline — queue a short, cap the spend, ship to every feed.">
        Bring any idea to the feed
      </DashHeading>

      <DashRise delay={0.1}>
      {(() => {
        const spent = Number(spendData.total_usd);
        const cap = globalCap !== null ? Number(globalCap) : null;
        const pct =
          cap && cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
        const hot = cap !== null && pct >= 80;
        const remaining = cap !== null ? Math.max(0, cap - spent) : null;

        // Delta slots carry real derivable values only: spend as % of the
        // daily cap, remaining cap %, and views per video. Stats with no
        // real delta render "—" inside the component.
        const viewsPerVideo =
          metricsSummary && metricsSummary.sampled_videos > 0
            ? metricsSummary.total_views / metricsSummary.sampled_videos
            : null;

        return (
          <SquareStatsCards
            stats={[
              {
                key: "spent",
                label: "Spent today",
                icon: WalletMinimal,
                value: formatUsd(spent),
                delta:
                  cap !== null
                    ? { text: `${pct}% of cap`, trend: hot ? "down" : "up" }
                    : null,
              },
              {
                key: "remaining",
                label: "Cap remaining",
                icon: Coins,
                value: remaining !== null ? formatUsd(remaining) : "—",
                delta:
                  cap !== null && cap > 0
                    ? {
                        text: `${100 - pct}% left`,
                        trend: hot ? "down" : "up",
                      }
                    : null,
              },
              {
                key: "niches",
                label: "Active niches",
                icon: Users,
                value: String(nichesList.length),
                delta: null,
              },
              {
                key: "views",
                label: "Views · 30d",
                icon: Eye,
                value: metricsSummary
                  ? fmtCompact(metricsSummary.total_views)
                  : "—",
                delta:
                  viewsPerVideo !== null
                    ? { text: `${fmtCompact(Math.round(viewsPerVideo))}/video` }
                    : null,
              },
            ]}
          />
        );
      })()}
      </DashRise>

      {showAyrshareBanner && (
        <DashRise delay={0.14}>
        <Card className={cn(hubCardClass, "border-destructive/50 bg-destructive/5")}>
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium">Posting profile not set up</div>
              <div className="text-sm text-muted-foreground">
                Pipeline runs will succeed, but posts won&apos;t ship until you
                create your posting profile and link socials in Ayrshare.
              </div>
            </div>
            <Button asChild variant="outline">
              <Link href="/connect">
                Connect socials
              </Link>
            </Button>
          </CardContent>
        </Card>
        </DashRise>
      )}

      {hasError && (
        <p className="text-sm text-muted-foreground">
          Live updates paused —{" "}
          {(nichesError ?? spendError)?.message ?? "fetch failed"}
        </p>
      )}

      {/* Template two-column slot (app/page.tsx + dashboard/content.tsx):
          chart + recent uploads, fed with real jobs data. Jobs carry no
          per-video view metric, so the chart plots videos published per
          bucket and is titled accordingly. */}
      <DashRise delay={0.16}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MonthlyViewsChart
            periodData={buildPublishedSeries(doneJobs ?? [])}
            title="Videos published"
            unit="videos"
          />
          <RecentUploads uploads={toRecentUploads(doneJobs ?? [])} />
        </div>
      </DashRise>

      <DashPanel
        actions={
          <Button asChild>
            <Link href="/onboarding">
              New niche
            </Link>
          </Button>
        }
        delay={0.18}
        title="Your niches"
      >
        {nichesList.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {nichesList.map((n) => (
              <NicheCard
                key={n.id}
                niche={n}
                spentToday={spendData.by_niche[n.id] ?? "0"}
                onArchive={handleArchive}
              />
            ))}
          </div>
        )}
      </DashPanel>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className={cn(hubCardClass, "border-dashed")}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <h3 className="text-lg font-semibold">No niches yet</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create one to start the pipeline. You can have as many as you want;
          each runs under its own daily spend cap.
        </p>
        <Button asChild>
          <Link href="/onboarding">
            Create your first niche
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function NicheCard({
  niche,
  spentToday,
  onArchive,
}: {
  niche: Niche;
  spentToday: string;
  onArchive: (niche: Niche) => Promise<void>;
}) {
  const { openRunConfirm } = useRunConfirm();
  const cap = Number(niche.daily_spend_cap_usd);
  const spent = Number(spentToday);
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  const tooltipText = `${formatUsd(spent)} of ${formatUsd(cap)} used today`;

  return (
    <HoverLift className="h-full">
    <Card
      className={cn(
        hubCardClass,
        hubCardHoverClass,
        "group flex h-full flex-col transition-colors duration-300 hover:border-brand/30",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg font-semibold">
            <Link
              href={`/niches/${niche.id}`}
              className="hover:underline"
            >
              {niche.title}
            </Link>
          </CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 h-8 w-8"
                aria-label={`More options for ${niche.title}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/niches/${niche.id}/edit`}>
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  void onArchive(niche);
                }}
                className="text-destructive focus:text-destructive"
              >
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardDescription className="line-clamp-2">
          {niche.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-4 pb-3">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">For:</span> {niche.target_audience}
        </div>

        {niche.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {niche.hashtags.slice(0, 6).map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal">
                #{tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>image: {niche.image_quality}</span>
          <span>video: {niche.video_resolution}</span>
          <span>scenes: {niche.scene_count}</span>
          <span>
            {niche.target_duration_sec}s · {niche.scene_max_duration_sec}s/scene
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Today</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-mono tabular-nums">
                  {formatUsd(spent)} / {formatUsd(cap)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{tooltipText}</TooltipContent>
            </Tooltip>
          </div>
          <Progress
            className={pct >= 80 ? "**:data-[slot=progress-range]:bg-brand" : undefined}
            value={pct}
          />
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 pt-0">
        {niche.platforms.map((p) => (
          <Button
            key={p}
            size="sm"
            variant="outline"
            aria-label={`Run ${niche.title} on ${PLATFORM_LABEL[p]}`}
            className="focus-visible:ring-2"
            onClick={() => openRunConfirm({ nicheId: niche.id, platform: p })}
          >
            {PLATFORM_LABEL[p]}
          </Button>
        ))}
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link href={`/niches/${niche.id}/edit`}>
            Edit
          </Link>
        </Button>
      </CardFooter>
    </Card>
    </HoverLift>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketLabel(d: Date, monthOnly = false): string {
  return monthOnly
    ? d.toLocaleDateString("en-US", { month: "short" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Real chart series derived from finished jobs' created_at timestamps.
 * Jobs carry no per-video view metric, so each point is the count of
 * videos published in that bucket (daily / weekly / bi-weekly / monthly,
 * matching the template's four periods).
 */
function buildPublishedSeries(jobs: Job[]): Record<Period, ChartPoint[]> {
  const times = jobs
    .map((j) => new Date(j.created_at).getTime())
    .filter((t) => Number.isFinite(t));

  const countBuckets = (
    buckets: number,
    bucketMs: number,
    monthOnly = false,
  ): ChartPoint[] => {
    const now = Date.now();
    const start = now - buckets * bucketMs;
    const counts = new Array<number>(buckets).fill(0);
    for (const t of times) {
      if (t < start || t > now) continue;
      const idx = Math.min(buckets - 1, Math.floor((t - start) / bucketMs));
      counts[idx] += 1;
    }
    return counts.map((views, i) => ({
      date: bucketLabel(new Date(start + i * bucketMs), monthOnly),
      views,
    }));
  };

  return {
    "1m": countBuckets(30, DAY_MS),
    "3m": countBuckets(13, 7 * DAY_MS),
    "6m": countBuckets(12, 14 * DAY_MS),
    "1y": countBuckets(12, 30 * DAY_MS, true),
  };
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Real uploads: newest finished jobs, previewed via the video proxy. */
function toRecentUploads(jobs: Job[]): RecentUpload[] {
  return jobs.slice(0, 6).map((job) => ({
    id: job.id,
    title: job.script?.idea?.hook ?? job.id.slice(0, 8),
    timeAgo: timeAgo(job.created_at),
    videoSrc: `/api/proxy/api/v1/jobs/${job.id}/video`,
    href: `/queue/${job.id}`,
  }));
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

