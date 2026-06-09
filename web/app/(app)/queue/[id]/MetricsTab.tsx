"use client";

// Metrics tab for the job detail page.
// Shows the latest engagement snapshot and a views-over-time line chart,
// pulling from GET /api/v1/jobs/{id}/metrics (D1 endpoint).

import * as React from "react";
import { ExternalLink } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { PostMetrics } from "@/lib/types";

interface Props {
  metrics: { latest: PostMetrics | null; history: PostMetrics[] } | null;
  providerPostId: string | null;
}

const lineConfig: ChartConfig = {
  views: {
    label: "Views",
    color: "hsl(var(--chart-1))",
  },
};

function fmtNum(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtWatchTime(s: string | null): string {
  if (!s) return "—";
  const sec = Number(s);
  if (isNaN(sec)) return "—";
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`;
  return `${sec.toFixed(0)}s`;
}

function fmtCompletion(r: string | null): string {
  if (!r) return "—";
  const n = Number(r);
  if (isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function MetricsTab({ metrics, providerPostId }: Props) {
  // Endpoint not yet deployed, or returned null
  if (!metrics) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No engagement data yet — Ayrshare analytics sync runs daily at 11:00 UTC.
        {providerPostId && (
          <div className="mt-3">
            <a
              href={`https://app.ayrshare.com/posts/${providerPostId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View post on Ayrshare
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    );
  }

  const { latest, history } = metrics;

  if (!latest) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No engagement data yet — Ayrshare analytics sync runs daily at 11:00 UTC.
        {providerPostId && (
          <div className="mt-3">
            <a
              href={`https://app.ayrshare.com/posts/${providerPostId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View post on Ayrshare
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    );
  }

  // Build chart data from history (views over time, sorted ascending)
  const chartData = [...history]
    .sort((a, b) => a.sampled_at.localeCompare(b.sampled_at))
    .map((m) => ({
      date: shortDate(m.sampled_at),
      views: m.views ?? 0,
    }));

  return (
    <div className="space-y-6">
      {/* 4 stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Views" value={fmtNum(latest.views)} />
        <StatCard label="Avg watch time" value={fmtWatchTime(latest.avg_watch_time_sec)} />
        <StatCard label="Completion rate" value={fmtCompletion(latest.completion_rate)} />
        <StatCard label="Likes" value={fmtNum(latest.likes)} />
      </div>

      {/* Views over time line chart */}
      {chartData.length > 1 && (
        <div>
          <div className="mb-2 text-sm font-medium">Views over time</div>
          <ChartContainer config={lineConfig} className="h-48 w-full">
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v: number) => fmtNum(v)}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                width={44}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value) =>
                      typeof value === "number" ? fmtNum(value) : String(value)
                    }
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="views"
                stroke="var(--color-views)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ChartContainer>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Last sampled: {new Date(latest.sampled_at).toLocaleString()}
        {providerPostId && (
          <>
            {" · "}
            <a
              href={`https://app.ayrshare.com/posts/${providerPostId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              View on Ayrshare
              <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
