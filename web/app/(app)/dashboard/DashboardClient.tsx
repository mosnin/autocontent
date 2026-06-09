"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  Link2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
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
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRunConfirm } from "@/components/run-confirm-dialog";
import { archiveNicheAction } from "@/lib/actions";
import { clientFetch } from "@/lib/client-fetcher";
import { formatUsd } from "@/lib/format";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Niches</h1>
          <p className="text-sm text-muted-foreground">
            Each niche is its own self-driving pipeline.
          </p>
        </div>
        <Button asChild>
          <Link href="/onboarding">
            <Plus className="h-4 w-4" />
            New niche
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Today&apos;s total spend</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-2xl font-semibold tracking-tight">
            {formatUsd(spendData.total_usd)}
            {globalCap !== null && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                / {formatUsd(globalCap)} global cap
              </span>
            )}
          </div>
          {globalCap !== null && (() => {
            const cap = Number(globalCap);
            const spent = Number(spendData.total_usd);
            const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Progress value={pct} className="h-2" />
                </TooltipTrigger>
                <TooltipContent>
                  {formatUsd(spent)} of {formatUsd(cap)} global daily cap used
                </TooltipContent>
              </Tooltip>
            );
          })()}
        </CardContent>
      </Card>

      {showAyrshareBanner && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <div className="font-medium">Ayrshare not connected</div>
                <div className="text-sm text-muted-foreground">
                  Pipeline runs will succeed locally, but posts won&apos;t ship
                  until you link a socials profile.
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
      )}

      {hasError && (
        <p className="text-sm text-muted-foreground">
          Live updates paused —{" "}
          {(nichesError ?? spendError)?.message ?? "fetch failed"}
        </p>
      )}

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
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
        </div>
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
    <Card className="flex flex-col">
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
          <Progress value={pct} />
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
  );
}
