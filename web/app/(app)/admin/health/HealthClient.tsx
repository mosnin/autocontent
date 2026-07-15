"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  PauseCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { adminKeys } from "@/lib/admin-api";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";
import type { SystemHealth } from "@/lib/admin-types";

const POLL_MS = 30_000;

export function HealthClient({ initial }: { initial: SystemHealth }) {
  const key = adminKeys.health();
  const { data, error, isValidating, mutate } = useSWR<SystemHealth>(
    key,
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial },
  );

  const [refreshedAt, setRefreshedAt] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (data) setRefreshedAt(Date.now());
  }, [data]);

  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Live updates paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) errorToastedRef.current = false;
  }, [error]);

  const health = data ?? initial;
  const stuck = health.stuck_jobs;
  const failed = health.failed_jobs_24h;

  const dbDown = !health.db_ok;
  const stuckWarn = stuck != null && stuck > 0;
  const failedWarn = failed != null && failed > 0;
  const attention = dbDown || stuckWarn || failedWarn;
  const critical = dbDown;

  async function onRefresh() {
    try {
      await mutate();
    } catch {
      // Errors surface via the SWR error toast above.
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            System health
          </h1>
          <p className="text-sm text-muted-foreground">
            Live backend and worker health. Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RelativeAge at={refreshedAt} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onRefresh()}
            disabled={isValidating}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isValidating && "animate-spin")}
              aria-hidden
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* overall status banner */}
      <StatusBanner attention={attention} critical={critical} />

      {error && (
        <p className="text-sm text-muted-foreground">
          Live updates paused — {error.message ?? "fetch failed"}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* database reachability */}
        <HealthCard
          color={dbDown ? "orange" : "green"}
          icon={<Database />}
          title="Database"
        >
          <Badge
            variant={dbDown ? "destructive" : "success"}
            className="font-mono lowercase"
          >
            {dbDown ? (
              <XCircle className="size-3" aria-hidden />
            ) : (
              <CheckCircle2 className="size-3" aria-hidden />
            )}
            {dbDown ? "down" : "reachable"}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">
            {dbDown
              ? "Primary database is not responding to probes."
              : "Primary database responded to the last probe."}
          </p>
        </HealthCard>

        {/* stuck jobs */}
        <StatCard
          color={stuckWarn ? "orange" : "blue"}
          icon={<PauseCircle />}
          title="Stuck jobs"
          value={stuck}
          tone={stuckWarn ? "warn" : undefined}
          foot={
            stuck == null
              ? "metric unavailable"
              : stuckWarn
                ? "wedged past expected runtime"
                : "none wedged"
          }
        />

        {/* failed jobs 24h */}
        <StatCard
          color={failedWarn ? "orange" : "blue"}
          icon={<AlertTriangle />}
          title="Failed jobs · 24h"
          value={failed}
          tone={failedWarn ? "warn" : undefined}
          foot={
            failed == null
              ? "metric unavailable"
              : failedWarn
                ? "review recent failures"
                : "none in last 24h"
          }
        />
      </div>
    </div>
  );
}

function StatusBanner({
  attention,
  critical,
}: {
  attention: boolean;
  critical: boolean;
}) {
  const accent = critical ? "destructive" : attention ? "brand" : "success";
  const Icon = attention ? AlertTriangle : CheckCircle2;

  return (
    <Card
      className={cn(
        attention && critical
          ? "border-destructive/40 bg-destructive/5"
          : attention
            ? "border-brand/30 bg-brand/5"
            : "border-success/30 bg-success/5",
      )}
    >
      <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span aria-hidden className="relative flex size-2.5">
            <span
              className={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                accent === "destructive"
                  ? "bg-destructive"
                  : accent === "brand"
                    ? "bg-brand"
                    : "bg-success",
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full",
                accent === "destructive"
                  ? "bg-destructive"
                  : accent === "brand"
                    ? "bg-brand"
                    : "bg-success",
              )}
            />
          </span>
          <div className="flex items-center gap-2">
            <Icon
              className={cn(
                "size-4",
                accent === "destructive"
                  ? "text-destructive"
                  : accent === "brand"
                    ? "text-brand"
                    : "text-success",
              )}
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold">
                {attention ? "Attention needed" : "All systems operational"}
              </p>
              <p className="text-xs text-muted-foreground">
                {attention
                  ? critical
                    ? "A core dependency is down — investigate immediately."
                    : "One or more metrics are outside their healthy range."
                  : "Database is reachable and no jobs are stuck or failing."}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** KPI-styled shell shared by the health cards (mirrors AdminKpiCard). */
function HealthCard({
  color,
  icon,
  title,
  children,
}: {
  color: "green" | "orange" | "blue" | "navy" | "purple";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2.5">
          <AppIcon color={color}>{icon}</AppIcon>
          <span className="text-sm font-medium text-muted-foreground">
            {title}
          </span>
        </div>
        <div>{children}</div>
      </CardContent>
    </Card>
  );
}

/** Numeric health stat, KPI-styled. Renders "—" when the metric is null. */
function StatCard({
  color,
  icon,
  title,
  value,
  foot,
  tone,
}: {
  color: "green" | "orange" | "blue" | "navy" | "purple";
  icon: React.ReactNode;
  title: string;
  value: number | null;
  foot: string;
  tone?: "warn";
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2.5">
          <AppIcon color={color}>{icon}</AppIcon>
          <span className="text-sm font-medium text-muted-foreground">
            {title}
          </span>
        </div>
        <p
          className={cn(
            "font-mono text-3xl font-semibold tabular-nums tracking-tight",
            value == null
              ? "text-muted-foreground"
              : tone === "warn"
                ? "text-brand"
                : "text-foreground",
          )}
        >
          {value == null ? "—" : value}
        </p>
        <div className="border-t border-border/60 pt-3 text-xs">
          <span
            className={cn(
              tone === "warn" ? "text-brand" : "text-muted-foreground",
            )}
          >
            {foot}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function RelativeAge({ at }: { at: number }) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 5_000);
    return () => clearInterval(t);
  }, []);

  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  const label =
    sec < 5 ? "just now" : sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)}m ago`;

  return (
    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
      Updated {label}
    </span>
  );
}
