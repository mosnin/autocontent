"use client";

// Metrics tab for the job detail page.
// Shows the latest engagement snapshot and a views-over-time line chart,
// pulling from GET /api/v1/jobs/{id}/metrics (D1 endpoint).

import * as React from "react";

import Grid from "@/components/charts/grid";
import LineChart, { Line } from "@/components/charts/line-chart";
import { ChartTooltip } from "@/components/charts/tooltip";
import type { PostMetrics } from "@/lib/types";

interface Props {
  metrics: { latest: PostMetrics | null; history: PostMetrics[] } | null;
  providerPostId: string | null;
}

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

function EmptyMetrics({ providerPostId }: { providerPostId: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-6 py-10 text-center">
      <span aria-hidden className="relative flex size-2">
        <span className="relative inline-flex size-2 rounded-full bg-brand" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">No engagement data yet</p>
        <p className="text-xs text-muted-foreground">
          The Ayrshare analytics sync runs daily at 11:00 UTC. Metrics appear
          here after the first snapshot lands.
        </p>
      </div>
      {providerPostId && (
        <a
          href={`https://app.ayrshare.com/posts/${providerPostId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
        >
          View post on Ayrshare
        </a>
      )}
    </div>
  );
}

export function MetricsTab({ metrics, providerPostId }: Props) {
  // Endpoint not yet deployed, or returned null / no snapshot.
  if (!metrics || !metrics.latest) {
    return <EmptyMetrics providerPostId={providerPostId} />;
  }

  const { latest, history } = metrics;

  // Secondary engagement metrics the API returns but we don't front on
  // the primary row. Only surface a tile when its value is present.
  const extraTiles: { label: string; value: string }[] = [];
  if (latest.comments !== null)
    extraTiles.push({ label: "Comments", value: fmtNum(latest.comments) });
  if (latest.shares !== null)
    extraTiles.push({ label: "Shares", value: fmtNum(latest.shares) });
  if (latest.saves !== null)
    extraTiles.push({ label: "Saves", value: fmtNum(latest.saves) });
  if (latest.reach !== null)
    extraTiles.push({ label: "Reach", value: fmtNum(latest.reach) });
  if (latest.impressions !== null)
    extraTiles.push({
      label: "Impressions",
      value: fmtNum(latest.impressions),
    });
  if (latest.watch_time_sec !== null)
    extraTiles.push({
      label: "Total watch time",
      value: fmtWatchTime(latest.watch_time_sec),
    });

  // Build chart data from history (views over time, sorted ascending).
  const chartData = [...history]
    .sort((a, b) => a.sampled_at.localeCompare(b.sampled_at))
    .map((m) => ({
      date: m.sampled_at.slice(0, 10),
      views: m.views ?? 0,
    }));

  return (
    <div className="space-y-6">
      {/* 4 stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Views" value={fmtNum(latest.views)} />
        <StatTile
          label="Avg watch time"
          value={fmtWatchTime(latest.avg_watch_time_sec)}
        />
        <StatTile
          label="Completion rate"
          value={fmtCompletion(latest.completion_rate)}
        />
        <StatTile label="Likes" value={fmtNum(latest.likes)} />
      </div>

      {/* Secondary engagement — comments, shares, saves, reach, etc. */}
      {extraTiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {extraTiles.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} />
          ))}
        </div>
      )}

      {/* Views over time — animated line-chart engine, brand-lit line. */}
      {chartData.length > 1 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Views over time
          </p>
          <LineChart
            aspectRatio="3 / 1"
            className="w-full"
            data={chartData}
            margin={{ top: 12, right: 16, bottom: 28, left: 16 }}
            xDataKey="date"
          >
            <Grid horizontal />
            <Line
              dataKey="views"
              stroke="hsl(var(--brand))"
              strokeWidth={2}
            />
            <ChartTooltip
              indicatorColor="hsl(var(--brand))"
              rows={(point) => [
                {
                  color: "hsl(var(--brand))",
                  label: "Views",
                  value: fmtNum((point.views as number) ?? 0),
                },
              ]}
            />
          </LineChart>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Last sampled:{" "}
        <span className="tabular-nums">
          {new Date(latest.sampled_at).toLocaleString()}
        </span>
        {providerPostId && (
          <>
            {" · "}
            <a
              href={`https://app.ayrshare.com/posts/${providerPostId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-brand hover:underline"
            >
              View on Ayrshare
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}
