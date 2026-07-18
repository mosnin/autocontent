"use client";

import * as React from "react";
import useSWR from "swr";
import { LineChart, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  analyticsKeys,
  gscRankingsFetcher,
  humanizeAnalyticsError,
  type GscRankingsResponse,
} from "@/lib/press-analytics-client";
import { cn } from "@/lib/utils";

const DAY_OPTIONS = [7, 28, 90] as const;

export function RankingsClient({
  initial,
  initialDays,
}: {
  initial: GscRankingsResponse;
  initialDays: number;
}) {
  const [days, setDays] = React.useState(initialDays);

  const { data, error, isLoading } = useSWR<GscRankingsResponse>(
    analyticsKeys.gscRankings(days),
    gscRankingsFetcher,
    {
      fallbackData: days === initialDays ? initial : undefined,
      keepPreviousData: true,
    },
  );

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rankings</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Top Search Console queries by clicks, with position change
            against the prior window of equal length.
          </p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                Last {d} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <h3 className="text-lg font-semibold">Couldn&apos;t load rankings</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {humanizeAnalyticsError(error)}
            </p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <LineChart className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No Search Console data synced yet.</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Connect a site on the Search Console page, then check back
              once the next sync runs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">Position</TableHead>
                <TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.query}>
                  <TableCell className="max-w-[320px] truncate font-medium">
                    {item.query}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {item.impressions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {item.position.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right">
                    <PositionDelta delta={item.position_delta} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function PositionDelta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-xs text-muted-foreground">New</span>;
  }
  if (Math.abs(delta) < 0.05) {
    return (
      <span className="inline-flex items-center justify-end gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden="true" />
        Steady
      </span>
    );
  }
  const improved = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-end gap-1 font-mono text-xs tabular-nums",
        improved ? "text-success" : "text-destructive",
      )}
    >
      {improved ? (
        <TrendingUp className="h-3 w-3" aria-hidden="true" />
      ) : (
        <TrendingDown className="h-3 w-3" aria-hidden="true" />
      )}
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}
