"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { PenLine, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  gscGapsFetcher,
  humanizeAnalyticsError,
  type GscGapsResponse,
} from "@/lib/press-analytics-client";

const DAY_OPTIONS = [28, 90, 180] as const;

export function GapsClient({
  initial,
  initialDays,
}: {
  initial: GscGapsResponse;
  initialDays: number;
}) {
  const [days, setDays] = React.useState(initialDays);

  const { data, error, isLoading } = useSWR<GscGapsResponse>(
    analyticsKeys.gscGaps(days),
    gscGapsFetcher,
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
          <h1 className="text-2xl font-semibold tracking-tight">Content gaps</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Queries Search Console shows impressions for that no existing
            article targets. Ranked queries below position 20 with real
            impression volume.
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
            <h3 className="text-lg font-semibold">Couldn&apos;t load content gaps</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {humanizeAnalyticsError(error)}
            </p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold">No content gaps found</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Either Search Console hasn&apos;t synced data yet, or every
              query with real impressions already has an article covering
              it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Position</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => (
                <TableRow key={`${item.query}-${i}`}>
                  <TableCell className="max-w-[260px] truncate font-medium">
                    {item.query}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {item.page}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.impressions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {item.clicks.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {item.position.toFixed(1)}
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/press/topics">
                        <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                        Draft topic
                      </Link>
                    </Button>
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
