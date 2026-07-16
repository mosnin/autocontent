import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Instagram,
  Music2,
  Pencil,
  Youtube,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Reveal } from "@/components/marketing/reveal";
import { LoopCircuit } from "@/components/marketing/pipeline-circuit";
import { SpendHistoryChart } from "@/components/spend-history-chart";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { statusVariant } from "@/lib/status-badge";
import { cn } from "@/lib/utils";
import type {
  Job,
  Niche,
  NichePerformance,
  Platform,
  SpendHistory,
  TodaySpend,
} from "@/lib/types";
import { NicheRunButtons } from "./NicheRunButtons";
import { PerformanceCard } from "./PerformanceCard";
import { CharacterSheetCard } from "./CharacterSheetCard";
import { RecentJobsTable } from "./RecentJobsTable";

export const dynamic = "force-dynamic";

const PLATFORM_META: Record<Platform, { label: string; icon: LucideIcon }> = {
  tiktok: { label: "TikTok", icon: Music2 },
  reels: { label: "Reels", icon: Instagram },
  shorts: { label: "Shorts", icon: Youtube },
};

async function fetchNiche(id: string): Promise<Niche | null> {
  try {
    return await api<Niche>(`/api/v1/niches/${id}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) return null;
    throw e;
  }
}

async function fetchSpendHistory(nicheId: string): Promise<SpendHistory> {
  try {
    return await api<SpendHistory>(
      `/api/v1/spend/history?days=30&niche_id=${nicheId}`,
    );
  } catch {
    return { rows: [], days: 30, total_usd: "0" };
  }
}

async function fetchTodaySpend(): Promise<TodaySpend> {
  try {
    return await api<TodaySpend>("/api/v1/spend/today");
  } catch {
    return { by_niche: {}, total_usd: "0" };
  }
}

const RECENT_JOBS_LIMIT = 20;

async function fetchRecentJobs(nicheId: string): Promise<Job[]> {
  try {
    return await api<Job[]>(
      `/api/v1/jobs?niche_id=${nicheId}&limit=${RECENT_JOBS_LIMIT}`,
    );
  } catch {
    return [];
  }
}

async function fetchPerformance(nicheId: string): Promise<NichePerformance | null> {
  try {
    return await api<NichePerformance>(
      `/api/v1/niches/${nicheId}/performance?days=30`,
    );
  } catch (e) {
    // 404 means the endpoint isn't deployed yet (parallel PR not merged)
    // or no data. Either way render an empty state gracefully.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404") || msg.startsWith("422")) return null;
    throw e;
  }
}

export default async function NichePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [niche, spendHistory, todaySpend, recentJobs, performance] =
    await Promise.all([
      fetchNiche(id),
      fetchSpendHistory(id),
      fetchTodaySpend(),
      fetchRecentJobs(id),
      fetchPerformance(id),
    ]);

  if (!niche) notFound();

  const cap = Number(niche.daily_spend_cap_usd);
  const todayUsd = Number(todaySpend.by_niche[niche.id] ?? "0");
  const total30dUsd = Number(spendHistory.total_usd);

  // Avg cost / video = 30-day spend ÷ jobs completed in that same 30-day
  // window. The numerator is a true 30-day figure, so the denominator must
  // be too — count only done jobs created within the window (not "the last
  // 20 done jobs ever", which over/under-counts and skews the average).
  const windowCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const doneJobs = recentJobs.filter((j) => j.status === "done");
  const windowDoneJobs = doneJobs.filter(
    (j) => new Date(j.created_at).getTime() >= windowCutoff,
  );
  // If we fetched the maximum page, older in-window jobs may exist that we
  // didn't see — the denominator is then a lower bound, so the average is an
  // upper bound. Flag it approximate rather than presenting a precise-looking
  // but inflated number.
  const jobsTruncated = recentJobs.length >= RECENT_JOBS_LIMIT;
  const avgCostUsd =
    windowDoneJobs.length > 0 ? total30dUsd / windowDoneJobs.length : 0;

  // "hot" when today's spend is within striking distance of the cap.
  const capPct = cap > 0 ? todayUsd / cap : 0;
  const hot = capPct >= 0.8;

  // Any in-flight pipeline stage renders as the "outline" variant — use it
  // as a proxy for a live run so the header can wear the recording dot.
  const live = recentJobs.some((j) => statusVariant(j.status) === "outline");
  const hasJobs = recentJobs.length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* back nav */}
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </Button>

      {/* header */}
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-brand">
                Niche
              </p>
              {live && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
                  <span aria-hidden className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-brand" />
                  </span>
                  Live
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {niche.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {niche.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {niche.platforms.map((p) => {
                const meta = PLATFORM_META[p];
                const Icon = meta?.icon;
                return (
                  <Badge key={p} variant="secondary" className="gap-1.5">
                    {Icon && <Icon className="size-3.5" />}
                    {meta?.label ?? p}
                  </Badge>
                );
              })}
              {niche.archived_at && (
                <Badge variant="destructive">Archived</Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/niches/${niche.id}/edit`}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Link>
            </Button>
          </div>
        </div>
      </Reveal>

      {/* run-now buttons (client) */}
      <NicheRunButtons niche={niche} />

      {/* stat cards */}
      <Reveal delay={0.05}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Today's spend / cap"
            value={formatUsd(todayUsd)}
            sub={`of ${formatUsd(cap)} daily cap`}
            hot={hot}
          />
          <StatCard
            label="30-day spend"
            value={formatUsd(total30dUsd)}
            sub="last 30 days"
          />
          <StatCard
            label="Avg cost / video"
            value={
              windowDoneJobs.length > 0
                ? `${jobsTruncated ? "~" : ""}${formatUsd(avgCostUsd)}`
                : "-"
            }
            sub={
              windowDoneJobs.length > 0
                ? `${jobsTruncated ? "≥" : ""}${windowDoneJobs.length} completed · 30d`
                : "no completed runs yet"
            }
          />
        </div>
      </Reveal>

      {/* spend chart */}
      <Reveal delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>Spend over time</CardTitle>
            <CardDescription>
              Daily USD spend for the last 30 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpendHistoryChart data={spendHistory.rows} days={30} />
          </CardContent>
        </Card>
      </Reveal>

      <CharacterSheetCard nicheId={niche.id} />

      {/* performance card */}
      <Reveal delay={0.1}>
        <PerformanceCard performance={performance} />
      </Reveal>

      {/* recent jobs */}
      <Reveal delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>Recent jobs</CardTitle>
            <CardDescription>
              Last 20 pipeline runs for this niche
            </CardDescription>
          </CardHeader>
          <CardContent className={hasJobs ? "p-0" : undefined}>
            {hasJobs ? (
              <RecentJobsTable jobs={recentJobs} />
            ) : (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <LoopCircuit className="max-w-[320px]" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No videos yet</p>
                  <p className="text-sm text-muted-foreground">
                    Trigger a run to start the loop.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  hot = false,
}: {
  label: string;
  value: string;
  sub: string;
  hot?: boolean;
}) {
  return (
    <Card
      className={cn(
        "border-border/60",
        hot && "border-brand/30 bg-brand/[0.04]",
      )}
    >
      <CardContent className="space-y-1.5 p-5">
        <div className="flex items-center gap-1.5">
          {hot && (
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-brand" />
            </span>
          )}
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
        </div>
        <div
          className={cn(
            "font-mono text-2xl font-semibold tabular-nums",
            hot && "text-brand",
          )}
        >
          {value}
        </div>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
