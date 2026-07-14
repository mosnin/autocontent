"use client";

// Daily spend, rendered on the animated line-chart engine (ncdai metrics
// aesthetic): natural curve, edge fades, grid shimmer on load, and a
// crosshair tooltip. Values follow the chart-* CSS palette in both themes.

import * as React from "react";

import Grid from "@/components/charts/grid";
import LineChart, { Line } from "@/components/charts/line-chart";
import { ChartTooltip } from "@/components/charts/tooltip";
import type { SpendHistoryRow } from "@/lib/types";

interface Props {
  data: SpendHistoryRow[];
  days: number;
}

// Aggregate multiple niche rows for the same day into a single point.
function aggregate(rows: SpendHistoryRow[]): { date: string; spend: number }[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + Number(row.cost_usd));
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, spend]) => ({ date, spend: Number(spend.toFixed(4)) }));
}

export function SpendHistoryChart({ data, days }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">
        No spend yet in the last {days} days. Run a job to populate this chart.
      </div>
    );
  }

  const chartData = aggregate(data);

  return (
    <LineChart
      aspectRatio="3 / 1"
      className="w-full"
      data={chartData}
      margin={{ top: 12, right: 16, bottom: 28, left: 16 }}
      xDataKey="date"
    >
      <Grid horizontal />
      <Line dataKey="spend" strokeWidth={2} />
      <ChartTooltip />
    </LineChart>
  );
}
