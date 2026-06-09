import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpendHistoryChart } from "@/components/spend-history-chart";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { StatusBadge } from "@/lib/status-badge";
import type { Job, Niche, NichePerformance, SpendHistory, TodaySpend } from "@/lib/types";
import { NicheRunButtons } from "./NicheRunButtons";
import { PerformanceCard } from "./PerformanceCard";
import { RecentJobsTable } from "./RecentJobsTable";

export const dynamic = "force-dynamic";

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
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

async function fetchRecentJobs(nicheId: string): Promise<Job[]> {
  try {
    return await api<Job[]>(`/api/v1/jobs?niche_id=${nicheId}&limit=20`);
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

  // Avg cost = 30d spend / count of done jobs in the last 30 jobs
  const doneJobs = recentJobs.filter((j) => j.status === "done");
  const avgCostUsd = doneJobs.length > 0 ? total30dUsd / doneJobs.length : 0;

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{niche.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{niche.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {niche.platforms.map((p) => (
              <Badge key={p} variant="secondary">
                {PLATFORM_LABEL[p] ?? p}
              </Badge>
            ))}
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

      {/* run-now buttons (client) */}
      <NicheRunButtons niche={niche} />

      {/* stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Today&apos;s spend / cap</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatUsd(todayUsd)}
            </div>
            <p className="text-xs text-muted-foreground">
              of {formatUsd(cap)} daily cap
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>30-day spend</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatUsd(total30dUsd)}
            </div>
            <p className="text-xs text-muted-foreground">last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg cost per video</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {doneJobs.length > 0 ? formatUsd(avgCostUsd) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {doneJobs.length} completed job{doneJobs.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* spend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Spend over time</CardTitle>
          <CardDescription>Daily USD spend for the last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <SpendHistoryChart data={spendHistory.rows} days={30} />
        </CardContent>
      </Card>

      {/* performance card */}
      <PerformanceCard performance={performance} />

      {/* recent jobs table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent jobs</CardTitle>
          <CardDescription>Last 20 pipeline runs for this niche</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <RecentJobsTable jobs={recentJobs} />
        </CardContent>
      </Card>
    </div>
  );
}
