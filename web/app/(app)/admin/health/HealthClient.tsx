"use client";

import { RefreshCw } from "lucide-react";
import * as React from "react";
import useSWR from "swr";
import { AdminFrame } from "@/components/app/admin/admin-frame";
import { Button, Callout, EmptyLine, KpiCard, Notice, Section, StatusBadge, Table, type StatusTone } from "@/design-system";
import { adminKeys } from "@/lib/admin-api";
import type { SystemHealth } from "@/lib/admin-types";
import { clientFetch } from "@/lib/client-fetcher";

// Types mirror the backend ops response models (marketer.repos.metrics /
// marketer.services.metrics). This panel owns its own contract.

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
export interface OpsSnapshot {
  generated_at: string;
  db_ok: boolean;
  thresholds: { error_rate_warn: number; stuck_after_minutes: number };
  spend_1h: SpendVelocity;
  spend_24h: SpendVelocity;
  provider_error_rates: ProviderErrorRateOut[];
  error_window_minutes: number;
  stuck: StuckWork;
  top_skus: TopSku[];
  any_provider_warn: boolean;
  any_stuck: boolean;
}
export interface ConfigCheck {
  capability: string;
  status: "ok" | "warn" | "error";
  message: string;
  details: Record<string, unknown>;
}
export interface ConfigHealthReport {
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
const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
function ageLabel(seconds: number | null): string {
  if (seconds == null) return "—";
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return hr < 48 ? `${hr}h` : `${Math.round(hr / 24)}d`;
}
const windowLabel = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 60)}h`);
const CHECK_TONE: Record<ConfigCheck["status"], StatusTone> = { ok: "positive", warn: "attention", error: "negative" };

/** System health (ref 05): status line, KPI row, then provider and spend tables. Polls every 30s. */
export function HealthClient({ initial, initialOps, initialConfigHealth }: { initial: SystemHealth; initialOps: OpsSnapshot | null; initialConfigHealth: ConfigHealthReport | null }) {
  const health = useSWR<SystemHealth>(adminKeys.health(), clientFetch, { refreshInterval: POLL_MS, fallbackData: initial });
  const ops = useSWR<OpsSnapshot>(OPS_METRICS_PATH, clientFetch, { refreshInterval: POLL_MS, fallbackData: initialOps ?? undefined });
  const config = useSWR<ConfigHealthReport>(OPS_CONFIG_HEALTH_PATH, clientFetch, { refreshInterval: POLL_MS * 4, fallbackData: initialConfigHealth ?? undefined });

  const [refreshedAt, setRefreshedAt] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (health.data || ops.data) setRefreshedAt(Date.now());
  }, [health.data, ops.data]);

  const h = health.data ?? initial;
  const snap = ops.data ?? initialOps;
  const dbDown = !h.db_ok;
  const stuck = h.stuck_jobs;
  const failed = h.failed_jobs_24h;
  const attention = dbDown || (stuck ?? 0) > 0 || (failed ?? 0) > 0;
  const validating = health.isValidating || ops.isValidating;
  const err = health.error ?? ops.error;

  const refresh = () => {
    void health.mutate();
    void ops.mutate();
    void config.mutate();
  };

  return (
    <AdminFrame
      crumbs={[{ label: "Health" }]}
      actions={
        <>
          <RelativeAge at={refreshedAt} />
          <Button size="sm" variant="ghost" onClick={refresh} loading={validating}>
            {!validating && <RefreshCw />}
            Refresh
          </Button>
        </>
      }
    >
      {err && <Notice error={`Live updates paused: ${err.message ?? "fetch failed"}`} />}
      <Callout tone={dbDown ? "negative" : attention ? "attention" : "neutral"} title={attention ? "Attention needed" : "All systems operational"}>
        {dbDown ? "The primary database isn't answering probes." : attention ? "One or more metrics are outside their healthy range." : "Database reachable, nothing stuck or failing."}
      </Callout>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Database" value={dbDown ? <span className="text-negative">Down</span> : "Reachable"} />
        <KpiCard label="Stuck jobs" value={stuck == null ? "—" : <span className={stuck > 0 ? "text-attention" : undefined}>{stuck}</span>} />
        <KpiCard label="Failed jobs · 24h" value={failed == null ? "—" : <span className={failed > 0 ? "text-attention" : undefined}>{failed}</span>} />
        <KpiCard label="Spend · 24h" value={snap ? usd(snap.spend_24h.total_usd) : "—"} />
      </div>

      {!snap ? (
        <EmptyLine>{ops.error ? `Ops metrics unavailable: ${ops.error.message ?? "fetch failed"}` : "Loading ops metrics…"}</EmptyLine>
      ) : (
        <>
          {!snap.db_ok && <Callout tone="negative">The database didn't answer the ops probe, so these numbers may be stale.</Callout>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Spend · 1h" value={usd(snap.spend_1h.total_usd)} />
            <KpiCard label="Stuck image posts" value={<span className={snap.stuck.image_posts_stuck > 0 ? "text-attention" : undefined}>{snap.stuck.image_posts_stuck}</span>} />
            <KpiCard label="Oldest stuck job" value={snap.stuck.jobs_stuck > 0 ? ageLabel(snap.stuck.jobs_oldest_stuck_seconds) : "—"} />
            <KpiCard label="Awaiting approval" value={snap.stuck.jobs_awaiting_approval + snap.stuck.image_posts_awaiting_approval} />
          </div>

          <Section title={`Provider error rates · ${windowLabel(snap.error_window_minutes)}`} action={<span className="text-[12px] text-fg-faint">Warn at {pct(snap.thresholds.error_rate_warn)}</span>}>
            <Table<ProviderErrorRateOut>
              rows={snap.provider_error_rates}
              rowKey={(r) => r.provider}
              empty={<EmptyLine>No paid provider calls in this window.</EmptyLine>}
              columns={[
                { key: "provider", label: "Provider", render: (r) => <span className="font-mono text-[12.5px]">{r.provider}</span> },
                { key: "total", label: "Calls", align: "right", render: (r) => r.total },
                { key: "failed", label: "Failed", align: "right", render: (r) => r.failed },
                { key: "rate", label: "Error rate", align: "right", render: (r) => <span className={r.warn ? "text-attention" : "text-fg-muted"}>{pct(r.error_rate)}</span> },
                { key: "status", label: "Status", align: "right", hideOnPhone: true, render: (r) => <StatusBadge tone={r.warn ? "attention" : "positive"}>{r.warn ? "Warn" : "OK"}</StatusBadge> },
              ]}
            />
          </Section>

          <div className="grid gap-3 lg:grid-cols-2">
            <SpendTable title="Spend by provider · 1h" velocity={snap.spend_1h} />
            <SpendTable title="Spend by provider · 24h" velocity={snap.spend_24h} />
          </div>

          <Section title="Top spend SKUs">
            <Table<TopSku>
              rows={snap.top_skus}
              rowKey={(s) => `${s.provider}-${s.sku}`}
              empty={<EmptyLine>No spend recorded in this window.</EmptyLine>}
              columns={[
                { key: "provider", label: "Provider", render: (s) => <span className="font-mono text-[12.5px]">{s.provider}</span> },
                { key: "sku", label: "SKU", render: (s) => <span className="block max-w-[260px] truncate font-mono text-[12.5px] text-fg-muted">{s.sku}</span> },
                { key: "units", label: "Units", align: "right", hideOnPhone: true, render: (s) => s.units },
                { key: "cost", label: "Cost", align: "right", render: (s) => usd(s.cost_usd) },
              ]}
            />
          </Section>
        </>
      )}

      {config.data?.available && config.data.checks && (
        <Section title="Config health">
          <Table<ConfigCheck>
            rows={config.data.checks}
            rowKey={(c) => c.capability}
            columns={[
              { key: "cap", label: "Capability", render: (c) => <span className="font-mono text-[12.5px]">{c.capability}</span> },
              { key: "msg", label: "Message", hideOnPhone: true, render: (c) => <span className="text-fg-muted">{c.message}</span> },
              { key: "status", label: "Status", align: "right", render: (c) => <StatusBadge tone={CHECK_TONE[c.status]}>{c.status === "ok" ? "OK" : c.status === "warn" ? "Warn" : "Error"}</StatusBadge> },
            ]}
          />
        </Section>
      )}
    </AdminFrame>
  );
}

function SpendTable({ title, velocity }: { title: string; velocity: SpendVelocity }) {
  return (
    <Section title={title}>
      <Table<ProviderSpend>
        rows={velocity.by_provider}
        rowKey={(p) => p.provider}
        empty={<EmptyLine>No spend in this window.</EmptyLine>}
        columns={[
          { key: "provider", label: "Provider", render: (p) => <span className="font-mono text-[12.5px]">{p.provider}</span> },
          { key: "units", label: "Units", align: "right", render: (p) => p.units },
          { key: "cost", label: "Cost", align: "right", render: (p) => usd(p.cost_usd) },
        ]}
      />
    </Section>
  );
}

function RelativeAge({ at }: { at: number }) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 5_000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  const label = sec < 5 ? "just now" : sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)}m ago`;
  return <span className="hidden text-[12px] text-fg-faint tabular sm:inline">Updated {label}</span>;
}
