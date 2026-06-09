"use client";

// Performance card for the niche detail page.
// Shows summary stat tiles, a scatter plot of cost vs views, and a
// mini-table of job-level performance — all derived from the
// GET /api/v1/niches/{id}/performance response.

import * as React from "react";
import Link from "next/link";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  Tooltip,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import type { NichePerformance, JobPerformance } from "@/lib/types";

interface Props {
  performance: NichePerformance | null;
}

const scatterConfig: ChartConfig = {
  done: {
    label: "Done",
    color: "hsl(142 76% 36%)",
  },
  failed: {
    label: "Failed",
    color: "hsl(0 84% 60%)",
  },
  other: {
    label: "Other",
    color: "hsl(217 91% 60%)",
  },
};

function formatViews(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function costPer1k(totalSpend: string, totalViews: number): string {
  const v = totalViews;
  const s = Number(totalSpend);
  if (v === 0 || isNaN(s)) return "—";
  return `$${((s / v) * 1000).toFixed(2)}`;
}

type SortKey = "views" | "cost_usd" | "cpp";
type SortDir = "asc" | "desc";

function jobCpp(job: JobPerformance): number | null {
  const v = job.views;
  const c = Number(job.cost_usd);
  if (!v || v === 0 || isNaN(c)) return null;
  return (c / v) * 1000;
}

interface ScatterPayload {
  x: number;
  y: number;
  job_id: string;
  status: string;
  hook: string | null;
}

function CustomScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ScatterPayload }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="grid min-w-[8rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium truncate max-w-[160px]">{d.hook ?? d.job_id.slice(0, 8)}</div>
      <div className="text-muted-foreground">Views: {formatViews(d.y)}</div>
      <div className="text-muted-foreground">Cost: ${d.x.toFixed(4)}</div>
    </div>
  );
}

export function PerformanceCard({ performance }: Props) {
  const [sortKey, setSortKey] = React.useState<SortKey>("views");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  // No data available (endpoint 404'd or not deployed yet)
  if (!performance) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance (30 days)</CardTitle>
          <CardDescription>Views, engagement and cost efficiency</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-sm text-muted-foreground">
            Run a video to start collecting performance data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { summary, jobs } = performance;

  // Empty window — no jobs ran
  if (summary.total_videos === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance (30 days)</CardTitle>
          <CardDescription>Views, engagement and cost efficiency</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-sm text-muted-foreground">
            Run a video to start collecting performance data.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Jobs ran but Ayrshare hasn't sampled yet
  const anyMetrics = jobs.some((j) => j.views !== null);
  const noMetricsNote = !anyMetrics ? (
    <p className="mt-3 text-xs text-muted-foreground">
      Analytics samples land 24h after the first post.
    </p>
  ) : null;

  // Scatter data — only include jobs with both cost and views
  const scatterData: ScatterPayload[] = jobs
    .filter((j) => j.views !== null)
    .map((j) => ({
      x: Number(j.cost_usd),
      y: j.views as number,
      job_id: j.job_id,
      status: j.status,
      hook: j.hook,
    }));

  function dotColor(status: string): string {
    if (status === "done") return "hsl(142 76% 36%)";
    if (status === "failed") return "hsl(0 84% 60%)";
    return "hsl(217 91% 60%)";
  }

  // Sortable table
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedJobs = [...jobs].sort((a, b) => {
    let av: number | null = null;
    let bv: number | null = null;
    if (sortKey === "views") {
      av = a.views;
      bv = b.views;
    } else if (sortKey === "cost_usd") {
      av = Number(a.cost_usd);
      bv = Number(b.cost_usd);
    } else {
      av = jobCpp(a);
      bv = jobCpp(b);
    }
    // nulls last
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sortDir === "asc" ? av - bv : bv - av;
  });

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-muted-foreground/40"> ↕</span>;
    return <span>{sortDir === "asc" ? " ↑" : " ↓"}</span>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance (30 days)</CardTitle>
        <CardDescription>Views, engagement and cost efficiency</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Total views</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {anyMetrics ? formatViews(summary.total_views) : "—"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Avg views / video</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {anyMetrics ? formatViews(Math.round(summary.avg_views_per_video)) : "—"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Cost / 1k views</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {anyMetrics ? costPer1k(summary.total_spend_usd, summary.total_views) : "—"}
            </div>
          </div>
        </div>

        {noMetricsNote}

        {/* Scatter chart */}
        {scatterData.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-medium">Performance vs Cost</div>
            <ChartContainer config={scatterConfig} className="h-52 w-full">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="x"
                  type="number"
                  name="Cost"
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  label={{ value: "Cost ($)", position: "insideBottom", offset: -2, fontSize: 11 }}
                />
                <YAxis
                  dataKey="y"
                  type="number"
                  name="Views"
                  tickFormatter={(v: number) => formatViews(v)}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  width={48}
                />
                <Tooltip content={<CustomScatterTooltip />} />
                <Scatter data={scatterData}>
                  {scatterData.map((entry, idx) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill={dotColor(entry.status)}
                      opacity={0.85}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ChartContainer>
            <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
                Done
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                Failed
              </span>
            </div>
          </div>
        )}

        {/* Mini table */}
        {jobs.length > 0 && (
          <div>
            <div className="mb-2 text-sm font-medium">Job breakdown</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hook</TableHead>
                  <TableHead
                    className="w-[90px] cursor-pointer select-none text-right"
                    onClick={() => toggleSort("views")}
                  >
                    Views<SortIcon k="views" />
                  </TableHead>
                  <TableHead
                    className="w-[90px] cursor-pointer select-none text-right"
                    onClick={() => toggleSort("cost_usd")}
                  >
                    Cost<SortIcon k="cost_usd" />
                  </TableHead>
                  <TableHead
                    className="w-[90px] cursor-pointer select-none text-right"
                    onClick={() => toggleSort("cpp")}
                  >
                    $/1k<SortIcon k="cpp" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedJobs.map((job) => {
                  const cpp = jobCpp(job);
                  return (
                    <TableRow
                      key={job.job_id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        window.location.href = `/queue/${job.job_id}`;
                      }}
                    >
                      <TableCell className="max-w-[180px]">
                        {job.hook ? (
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <span className="block truncate text-sm">
                                {job.hook}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              {job.hook}
                            </TooltipContent>
                          </UITooltip>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {job.job_id.slice(0, 8)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatViews(job.views)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${Number(job.cost_usd).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cpp !== null ? `$${cpp.toFixed(2)}` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
