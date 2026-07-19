"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  Eye,
  Layers,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";

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
import { AppIcon } from "@/components/ui/app-icon";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BannerCard,
  DashHeading,
  DashPanel,
  DashRise,
  MediaCard,
} from "@/components/hub/dashboard-kit";
import {
  HoverLift,
  hubCardClass,
  hubCardHoverClass,
} from "@/components/hub/primitives";
import { LatestVideos } from "@/components/latest-videos";
import { LoopCircuit } from "@/components/marketing/pipeline-circuit";
import { useRunConfirm } from "@/components/run-confirm-dialog";
import { archiveNicheAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Niche, Platform, TodaySpend } from "@/lib/types";

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

      <div className="grid gap-5 lg:grid-cols-2">
        <DashRise delay={0.08}>
          <BannerCard
            href="/queue"
            media={
              <div className="flex h-full min-h-44 flex-col justify-center gap-2 p-5">
                {[
                  { label: "Morning hook — POV clip", state: "Rendering" },
                  { label: "Top 5 countdown", state: "Queued" },
                  { label: "Behind the scenes", state: "Posted" },
                ].map((row) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-2.5 text-[13px]"
                    key={row.label}
                  >
                    <span className="truncate font-medium">{row.label}</span>
                    <span className="shrink-0 rounded-full border border-border/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {row.state}
                    </span>
                  </div>
                ))}
              </div>
            }
            tagline="Line up shorts and let the pipeline render, caption, and post"
            title="Queue a short"
          />
        </DashRise>
        <DashRise delay={0.16}>
          <BannerCard
            badge="Autopilot"
            href="/niches"
            media={
              <div className="grid h-full min-h-44 content-center gap-2 p-5 sm:grid-cols-2">
                {[
                  { name: "Stoic quotes", meta: "3 platforms" },
                  { name: "Cozy cooking", meta: "daily cap $4" },
                  { name: "Retro tech", meta: "2 shorts/day" },
                  { name: "Trail running", meta: "auto-post on" },
                ].map((tile) => (
                  <div
                    className="rounded-xl border border-border/60 bg-card px-3.5 py-2.5"
                    key={tile.name}
                  >
                    <div className="truncate text-[13px] font-medium">
                      {tile.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {tile.meta}
                    </div>
                  </div>
                ))}
              </div>
            }
            tagline="Standing pipelines that post on their own schedule"
            title="Niches"
          />
        </DashRise>
      </div>

      <DashPanel delay={0.1} title="Create with every tool">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          <MediaCard
            foot="Runs, renders, retries"
            href="/queue"
            media={
              <div className="flex h-full min-h-24 flex-col justify-center gap-1.5 p-3">
                {["Render 02:14", "Caption pass", "Post to Shorts"].map((r) => (
                  <div
                    className="rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-[11px] font-medium"
                    key={r}
                  >
                    {r}
                  </div>
                ))}
              </div>
            }
            title="Queue"
          />
          <MediaCard
            foot="See the week's slots"
            href="/calendar"
            media={
              <div className="grid h-full min-h-24 grid-cols-4 content-center gap-1.5 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    className={cn(
                      "aspect-square rounded-lg border border-border/60",
                      i === 2 || i === 5 ? "bg-zinc-900/80" : "bg-card",
                    )}
                    key={i}
                  />
                ))}
              </div>
            }
            title="Calendar"
          />
          <MediaCard
            foot="Every video you've shipped"
            href="/library"
            media={
              <div className="flex h-full min-h-24 items-center justify-center gap-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div
                    className={cn(
                      "h-16 w-9 rounded-lg border border-border/60 bg-card",
                      i === 1 && "h-20 w-11 bg-zinc-900/80",
                    )}
                    key={i}
                  />
                ))}
              </div>
            }
            title="Library"
          />
          <MediaCard
            foot="Reusable video recipes"
            href="/templates"
            media={
              <div className="flex h-full min-h-24 flex-col justify-center gap-1.5 p-3">
                {["Hook + b-roll", "Countdown list", "Voiceover story"].map(
                  (t) => (
                    <div
                      className="rounded-lg border border-dashed border-border/80 bg-card px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground"
                      key={t}
                    >
                      {t}
                    </div>
                  ),
                )}
              </div>
            }
            title="Templates"
          />
          <MediaCard
            foot="Pipelines and their caps"
            href="/niches"
            media={
              <div className="flex h-full min-h-24 flex-col justify-center gap-1.5 p-3">
                {[70, 40, 15].map((w) => (
                  <div
                    className="rounded-lg border border-border/60 bg-card px-2.5 py-2"
                    key={w}
                  >
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900/10">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#f59e0b,#f43f5e)]"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            }
            title="Niches"
          />
        </div>
      </DashPanel>

      <DashPanel delay={0.12} title="Today at a glance">
      {(() => {
        const spent = Number(spendData.total_usd);
        const cap = globalCap !== null ? Number(globalCap) : null;
        const pct =
          cap && cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
        const hot = cap !== null && pct >= 80;
        const remaining = cap !== null ? Math.max(0, cap - spent) : null;

        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              color="green"
              foot={
                cap !== null ? `of ${formatUsd(cap)} daily cap` : "no cap set"
              }
              icon={<DollarSign />}
              title="Spent today"
              tone={hot ? "warn" : undefined}
              trail={cap !== null ? `${pct}%` : undefined}
              value={formatUsd(spent)}
            />
            <KpiCard
              color="blue"
              foot={cap !== null ? "resets at midnight UTC" : undefined}
              footLink={cap === null ? { href: "/settings", label: "Set a cap" } : undefined}
              icon={<Wallet />}
              title="Cap remaining"
              value={remaining !== null ? formatUsd(remaining) : "—"}
            />
            <KpiCard
              color="navy"
              foot="each on its own cap"
              icon={<Layers />}
              title="Active niches"
              value={String(nichesList.length)}
            />
            <KpiCard
              color="orange"
              foot={
                metricsSummary && metricsSummary.sampled_videos > 0
                  ? `across ${metricsSummary.sampled_videos} videos`
                  : "no data yet"
              }
              icon={<Eye />}
              title="Views · 30d"
              value={
                metricsSummary
                  ? fmtCompact(metricsSummary.total_views)
                  : "—"
              }
            />
          </div>
        );
      })()}
      </DashPanel>

      {showAyrshareBanner && (
        <DashRise delay={0.14}>
        <Card className={cn(hubCardClass, "border-destructive/50 bg-destructive/5")}>
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <div className="font-medium">Posting profile not set up</div>
                <div className="text-sm text-muted-foreground">
                  Pipeline runs will succeed, but posts won&apos;t ship until you
                  create your posting profile and link socials in Ayrshare.
                </div>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link href="/connect">
                <Link2 className="h-4 w-4" />
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

      <DashRise delay={0.16}>
        <LatestVideos />
      </DashRise>

      <DashPanel
        actions={
          <Button asChild>
            <Link href="/onboarding">
              <Plus className="h-4 w-4" />
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
        <LoopCircuit className="scale-75 opacity-90" />
        <h3 className="text-lg font-semibold">No niches yet</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create one to start the pipeline. You can have as many as you want;
          each runs under its own daily spend cap.
        </p>
        <Button asChild>
          <Link href="/onboarding">
            <Plus className="h-4 w-4" />
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
                  <Pencil /> Edit
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
                <Trash2 /> Archive
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
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            {PLATFORM_LABEL[p]}
          </Button>
        ))}
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link href={`/niches/${niche.id}/edit`}>
            Edit
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
    </HoverLift>
  );
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function KpiCard({
  color,
  icon,
  title,
  value,
  foot,
  footLink,
  trail,
  tone,
}: {
  color: "green" | "orange" | "blue" | "navy" | "purple";
  icon: React.ReactNode;
  title: string;
  value: string;
  foot?: string;
  footLink?: { href: string; label: string };
  trail?: string;
  tone?: "warn";
}) {
  return (
    <Card className={hubCardClass}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AppIcon color={color}>{icon}</AppIcon>
            <span className="text-sm font-medium text-muted-foreground">
              {title}
            </span>
          </div>
        </div>
        <p
          className={cn(
            "font-mono text-3xl font-semibold tabular-nums tracking-tight",
            tone === "warn" ? "text-brand" : "text-foreground",
          )}
        >
          {value}
        </p>
        <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
          {footLink ? (
            <Link className="text-brand hover:underline" href={footLink.href}>
              {footLink.label}
            </Link>
          ) : (
            <span className="text-muted-foreground">{foot ?? "\u00A0"}</span>
          )}
          {trail && (
            <span
              className={cn(
                "font-mono tabular-nums",
                tone === "warn" ? "text-brand" : "text-muted-foreground",
              )}
            >
              {trail}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
