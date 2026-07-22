"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";

import { AdminKpiCard } from "@/components/admin/kpi-card";
import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/square/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import { clientFetch } from "@/lib/client-fetcher";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------------------
// Types mirror the backend response models exactly (marketer.repos.metrics /
// marketer.services.metrics). Kept local to this file rather than added to
// lib/admin-types.ts — this panel owns its own contract.
// --------------------------------------------------------------------------

export interface ProviderSpend {
  provider: string;
  cost_usd: string;
  units: string;
}

export interface SpendVelocity {
  window_minutes: number;
  total_usd: string;
  by_provider: ProviderSpend[];
}

export interface ProviderErrorRateOut {
  provider: string;
  total: number;
  failed: number;
  error_rate: number;
  warn: boolean;
}

export interface StuckWork {
  stuck_after_minutes: number;
  jobs_stuck: number;
  jobs_oldest_stuck_seconds: number | null;
  image_posts_stuck: number;
  image_posts_oldest_stuck_seconds: number | null;
  jobs_awaiting_approval: number;
  image_posts_awaiting_approval: number;
}

export interface TopSku {
  provider: string;
  sku: string;
  cost_usd: string;
  units: string;
}

export interface OpsThresholds {
  error_rate_warn: number;
  stuck_after_minutes: number;
}

export interface OpsSnapshot {
  generated_at: string;
  db_ok: boolean;
  thresholds: OpsThresholds;
  spend_1h: SpendVelocity;
  spend_24h: SpendVelocity;
  provider_error_rates: ProviderErrorRateOut[];
  error_window_minutes: number;
  stuck: StuckWork;
  top_skus: TopSku[];
  any_provider_warn: boolean;
  any_stuck: boolean;
}

interface ConfigCheck {
  capability: string;
  status: "ok" | "warn" | "error";
  message: string;
  details: Record<string, unknown>;
}

interface ConfigHealthReport {
  available: boolean;
  overall_status?: "ok" | "warn" | "error";
  checks?: ConfigCheck[];
}

const OPS_METRICS_PATH = "/api/v1/ops/metrics";
const OPS_CONFIG_HEALTH_PATH = "/api/v1/ops/config-health";
const POLL_MS = 30_000;

function usd(raw: string): string {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return "$—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function ageLabel(seconds: number | null): string {
  if (seconds == null) return "—";
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export function OpsClient({
  initial,
  initialConfigHealth,
}: {
  initial: OpsSnapshot | null;
  initialConfigHealth: ConfigHealthReport | null;
}) {
  const { data, error, isValidating, mutate } = useSWR<OpsSnapshot>(
    OPS_METRICS_PATH,
    clientFetch,
    { refreshInterval: POLL_MS, fallbackData: initial ?? undefined },
  );
  const { data: configHealth } = useSWR<ConfigHealthReport>(
    OPS_CONFIG_HEALTH_PATH,
    clientFetch,
    { refreshInterval: POLL_MS * 4, fallbackData: initialConfigHealth ?? undefined },
  );

  const [refreshedAt, setRefreshedAt] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (data) setRefreshedAt(Date.now());
  }, [data]);

  const errorToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (error && !errorToastedRef.current) {
      errorToastedRef.current = true;
      toast.error(`Ops metrics paused: ${error.message ?? "fetch failed"}`);
    }
    if (!error) errorToastedRef.current = false;
  }, [error]);

  const snap = data ?? initial;

  async function onRefresh() {
    try {
      await mutate();
    } catch {
      // surfaced via the toast above
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Ops metrics
          </h2>
          <p className="text-sm text-muted-foreground">
            Provider error rates, spend velocity, and stuck work. Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {snap && (
            <RelativeAge at={refreshedAt} />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onRefresh()}
            disabled={isValidating}
          >
            Refresh
          </Button>
        </div>
      </div>

      {!snap ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {error
              ? `Ops metrics unavailable — ${error.message ?? "fetch failed"}`
              : "Loading ops metrics…"}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminKpiCard
              color="green"
              title="Spend · 1h"
              value={usd(snap.spend_1h.total_usd)}
              foot={
                snap.spend_1h.by_provider.length
                  ? `across ${snap.spend_1h.by_provider.length} provider${snap.spend_1h.by_provider.length === 1 ? "" : "s"}`
                  : "no spend in the last hour"
              }
            />
            <AdminKpiCard
              color="blue"
              title="Spend · 24h"
              value={usd(snap.spend_24h.total_usd)}
              foot={
                snap.spend_24h.by_provider.length
                  ? `across ${snap.spend_24h.by_provider.length} provider${snap.spend_24h.by_provider.length === 1 ? "" : "s"}`
                  : "no spend in the last 24h"
              }
            />
            <AdminKpiCard
              color={snap.any_stuck ? "orange" : "navy"}
              title="Stuck jobs"
              value={String(snap.stuck.jobs_stuck)}
              tone={snap.stuck.jobs_stuck > 0 ? "warn" : undefined}
              foot={
                snap.stuck.jobs_stuck > 0
                  ? `oldest ${ageLabel(snap.stuck.jobs_oldest_stuck_seconds)} · past ${snap.stuck.stuck_after_minutes}m reap window`
                  : "none wedged"
              }
            />
            <AdminKpiCard
              color={snap.stuck.image_posts_stuck > 0 ? "orange" : "navy"}
              title="Stuck image posts"
              value={String(snap.stuck.image_posts_stuck)}
              tone={snap.stuck.image_posts_stuck > 0 ? "warn" : undefined}
              foot={
                snap.stuck.image_posts_stuck > 0
                  ? `oldest ${ageLabel(snap.stuck.image_posts_oldest_stuck_seconds)}`
                  : "none wedged"
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                Provider error rates ·{" "}
                {snap.error_window_minutes >= 1440
                  ? `${Math.round(snap.error_window_minutes / 1440)}d`
                  : `${Math.round(snap.error_window_minutes / 60)}h`}{" "}
                window
              </CardTitle>
            </CardHeader>
            <CardContent>
              {snap.provider_error_rates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No jobs or image posts touched a paid provider in this window.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Touched</TableHead>
                        <TableHead className="text-right">Failed</TableHead>
                        <TableHead className="text-right">Error rate</TableHead>
                        <TableHead className="w-[90px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snap.provider_error_rates.map((r) => (
                        <TableRow key={r.provider}>
                          <TableCell className="font-mono">{r.provider}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.total}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.failed}</TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono tabular-nums",
                              r.warn ? "text-warning" : "text-muted-foreground",
                            )}
                          >
                            {pct(r.error_rate)}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.warn ? (
                              <Badge
                                variant="outline"
                                className="font-mono lowercase bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900"
                              >
                                warn
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="font-mono lowercase bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900"
                              >
                                ok
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                WARN threshold: error rate ≥ {pct(snap.thresholds.error_rate_warn)} of jobs/image posts a provider was billed against.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SpendByProviderCard title="Spend by provider · 1h" velocity={snap.spend_1h} />
            <SpendByProviderCard title="Spend by provider · 24h" velocity={snap.spend_24h} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top spend SKUs</CardTitle>
            </CardHeader>
            <CardContent>
              {snap.top_skus.length === 0 ? (
                <p className="text-sm text-muted-foreground">No spend recorded in this window.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Units</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snap.top_skus.map((s) => (
                        <TableRow key={`${s.provider}-${s.sku}`}>
                          <TableCell className="font-mono">{s.provider}</TableCell>
                          <TableCell className="font-mono">{s.sku}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.units}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {usd(s.cost_usd)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {!snap.db_ok && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="py-4 text-sm text-destructive-foreground">
                Database did not respond to the ops probe — the numbers above may be stale.
              </CardContent>
            </Card>
          )}
        </>
      )}

      {configHealth?.available && configHealth.checks && (
        <Card>
          <CardHeader>
            <CardTitle>Config health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {configHealth.checks.map((c) => (
              <div
                key={c.capability}
                className="flex items-start justify-between gap-3 border-b border-border/40 py-2 text-sm last:border-b-0"
              >
                <div>
                  <div className="font-mono text-xs text-muted-foreground">{c.capability}</div>
                  <div>{c.message}</div>
                </div>
                <Badge
                  variant={c.status === "error" ? "destructive" : "outline"}
                  className={cn(
                    "shrink-0 font-mono lowercase",
                    c.status === "warn" &&
                      "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900",
                    c.status === "ok" &&
                      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900",
                  )}
                >
                  {c.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SpendByProviderCard({ title, velocity }: { title: string; velocity: SpendVelocity }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {velocity.by_provider.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spend in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {velocity.by_provider.map((p) => (
                  <TableRow key={p.provider}>
                    <TableCell className="font-mono">{p.provider}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.units}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{usd(p.cost_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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
