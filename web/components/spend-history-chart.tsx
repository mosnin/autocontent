"use client";

// Bar chart of daily spend. Wraps recharts in the shadcn ChartContainer
// so colours follow the app's CSS variable palette in dark mode.

import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { SpendHistoryRow } from "@/lib/types";

interface Props {
  data: SpendHistoryRow[];
  days: number;
}

const chartConfig: ChartConfig = {
  cost_usd: {
    label: "Spend (USD)",
    color: "hsl(var(--chart-1))",
  },
};

// Aggregate multiple niche rows for the same day into a single bar.
function aggregate(rows: SpendHistoryRow[]): { day: string; cost_usd: number }[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + Number(row.cost_usd));
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, cost_usd]) => ({ day, cost_usd }));
}

function shortDate(iso: string): string {
  // "2026-01-15" → "Jan 15"
  const [, m, d] = iso.split("-");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${monthNames[Number(m) - 1]} ${Number(d)}`;
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
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="day"
          tickFormatter={shortDate}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={52}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value) =>
                typeof value === "number" ? `$${value.toFixed(4)}` : String(value)
              }
              labelFormatter={(label) => shortDate(String(label))}
            />
          }
        />
        <Bar dataKey="cost_usd" fill="var(--color-cost_usd)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
