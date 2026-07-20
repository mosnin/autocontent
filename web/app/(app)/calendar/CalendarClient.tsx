"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashHeading } from "@/components/hub/dashboard-kit";
import { hubCardClass } from "@/components/hub/primitives";
import { cn } from "@/lib/utils";
import { AgendaList } from "@/components/calendar/AgendaList";
import {
  calendarKey,
  CALENDAR_RANGES,
  DEFAULT_CALENDAR_RANGE,
  type CalendarItem,
  type CalendarRange,
} from "@/components/calendar/types";
import { groupByDay, summarize } from "@/components/calendar/utils";
import { clientFetch } from "@/lib/client-fetcher";

// Posting windows move slowly; a 60s refresh keeps the agenda fresh
// without the aggressive polling the live pipeline views use.
const POLL_MS = 60_000;

const RANGE_LABEL: Record<CalendarRange, string> = {
  7: "Next 7 days",
  30: "Next 30 days",
  90: "Next 90 days",
};

export function CalendarClient({ initial }: { initial: CalendarItem[] }) {
  const [range, setRange] = React.useState<CalendarRange>(
    DEFAULT_CALENDAR_RANGE,
  );
  // True from the moment the user picks a new range until its data arrives.
  // keepPreviousData means the old agenda stays on screen, so without this the
  // switch would feel unresponsive on a slow fetch.
  const [switching, setSwitching] = React.useState(false);

  const { data, error } = useSWR<CalendarItem[]>(
    calendarKey(range),
    clientFetch,
    {
      refreshInterval: POLL_MS,
      // fallbackData only matches the default window's key; switching
      // range fetches fresh (keepPreviousData avoids a content flash).
      fallbackData: range === DEFAULT_CALENDAR_RANGE ? initial : undefined,
      keepPreviousData: true,
    },
  );

  // Clear the pending flag once fresh data lands (a background poll clearing an
  // already-false flag is a harmless no-op).
  React.useEffect(() => {
    setSwitching(false);
  }, [data]);

  function onRangeChange(next: CalendarRange) {
    if (next === range) return;
    setSwitching(true);
    setRange(next);
  }

  // Toast only the first error in a sequence, not every poll failure.
  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Live updates paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) {
      errorToastedRef.current = false;
    }
  }, [error]);

  const items = data ?? [];
  const groups = React.useMemo(() => groupByDay(items), [items]);
  const { phrase } = summarize(items);

  return (
    <div className="space-y-6">
      <DashHeading
        as="h1"
        sub={
          items.length === 0
            ? `Nothing scheduled in the next ${range} days.`
            : `${phrase} scheduled in the next ${range} days.`
        }
      >
        Calendar
      </DashHeading>

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={String(range)}
          onValueChange={(v) => onRangeChange(Number(v) as CalendarRange)}
        >
          <TabsList>
            {CALENDAR_RANGES.map((r) => (
              <TabsTrigger key={r} value={String(r)}>
                {RANGE_LABEL[r]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {switching && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
          >
            <Spinner className="size-3.5" aria-hidden />
            Updating…
          </span>
        )}
      </div>

      <div
        className={cn(
          "transition-opacity",
          switching && "pointer-events-none opacity-60",
        )}
        aria-busy={switching}
      >
        {groups.length === 0 ? (
          <EmptyState range={range} />
        ) : (
          <AgendaList groups={groups} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ range }: { range: CalendarRange }) {
  return (
    <Card className={hubCardClass}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <h3 className="text-lg font-semibold">Nothing scheduled</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          No videos or articles are set to post in the next {range} days. Kick
          off a run from a niche and approved posts will land here.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Go to niches
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
