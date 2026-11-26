"use client";

import { ArrowLeftRight, BarChart3, CalendarRange, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  AskPill,
  BarList,
  BreakdownList,
  IconButton,
  ButtonLink,
  Canvas,
  ChartCard,
  cx,
  DataLabel,
  EmptyLine,
  FilterPill,
  KpiCard,
  LineChart,
  PageHeader,
  StatusBadge,
  Table,
  ToolIcon,
  Toolbar,
} from "@/design-system";
import type { AdsOverview } from "@/lib/ads-client";
import { formatCompact, formatUsd } from "@/lib/format";
import type { PerformanceSummary, SpendHistory } from "@/lib/types";
import { hrefFor, type Overview, type SeriesRow } from "@/lib/workspace";
import { TOOL_ICON } from "@/components/shell/sidebar";
import { askHref, type Period, PERIODS } from "./period";

export interface MetricsSummary {
  total_views: number;
  sampled_videos: number;
  best_job_id: string | null;
  best_views: number | null;
  days: number;
}

export interface PlaybookPerformance {
  id: string;
  title: string;
  summary: PerformanceSummary | null;
}

export interface AnalyticsData {
  days: Period;
  overview: Overview | null;
  /** The `days` before the window, day by day (for the comparison line). */
  previousSeries: SeriesRow[] | null;
  spend: SpendHistory | null;
  ads: AdsOverview | null;
  metrics: MetricsSummary | null;
  playbooks: PlaybookPerformance[];
  /** Hide the comparison line (?compare=off). */
  compare?: boolean;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const pct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
const per1k = (spend: number, views: number) => (views > 0 ? (spend / views) * 1000 : 0);
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
/** Sum a daily series into ~n buckets so row sparklines read as a trend. */
const bucket = (vals: number[], n = 10) => {
  const size = Math.max(1, Math.ceil(vals.length / n));
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += size) out.push(vals.slice(i, i + size).reduce((a, v) => a + v, 0));
  return out;
};
const usd = (n: number) => formatUsd(n, { cents: n < 100 });
const PLATFORM: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts", youtube: "YouTube", instagram: "Instagram", x: "X", linkedin: "LinkedIn", blog: "Blog" };

/** Analytics (ref 05): filters, KPI row, the main chart with its breakdown, then three smaller cards. */
export function AnalyticsView(data: AnalyticsData) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const compare = data.compare !== false;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params?.toString());
    next.set(key, value);
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <>
      <PageHeader
        icon={<BarChart3 />}
        title="Analytics"
        actions={
          <ButtonLink href={askHref("Write me a one-page report on the last " + data.days + " days: what moved, why, and what to do next")} variant="primary">
            Get a report
          </ButtonLink>
        }
      />
      <Toolbar
        end={
          <IconButton label="Refresh" onClick={() => start(() => router.refresh())} disabled={pending}>
            <RefreshCw className={cx(pending && "ds-spin")} />
          </IconButton>
        }
      >
        <FilterPill label="Date range" icon={<CalendarRange />} value={String(data.days)} options={PERIODS.map((p) => ({ value: String(p), label: `Last ${p} days` }))} onChange={(v) => set("days", v)} />
        <FilterPill label="Compare" icon={<ArrowLeftRight />} value={compare ? "on" : "off"} options={[{ value: "on", label: "Compare to previous" }, { value: "off", label: "No comparison" }]} onChange={(v) => set("compare", v)} />
      </Toolbar>
      <Canvas className={cx("transition-opacity", pending && "opacity-60")}>
        {data.overview ? <Body {...data} overview={data.overview} compare={compare} /> : <EmptyLine>Couldn't load your numbers. The API didn't answer; try Refresh in a moment.</EmptyLine>}
        <AskPill label="Ask the Analyst" href={askHref()} />
      </Canvas>
    </>
  );
}

function Body({ days, overview: o, previousSeries, spend, ads, metrics, playbooks, compare }: AnalyticsData & { overview: Overview; compare: boolean }) {
  const k = o.kpis;
  const p = o.previous_kpis;
  const s = o.series;
  const labels = s.map((r) => day(r.day));
  const spendOf = (r: SeriesRow) => num(r.content_spend_usd) + num(r.ad_spend_usd);
  const totalSpend = num(k.total_spend_usd);
  const prevSpend = num(p.total_spend_usd);
  const prev = compare && previousSeries && previousSeries.length === s.length ? previousSeries : null;
  const showConversions = k.ad_conversions > 0 || p.ad_conversions > 0;
  const published = k.posts_published + k.articles_published;
  const prevPublished = p.posts_published + p.articles_published;
  const views = s.reduce((a, r) => a + r.views, 0);
  const prevViews = prev?.reduce((a, r) => a + r.views, 0) ?? 0;

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total spend" value={usd(totalSpend)} delta={pct(totalSpend, prevSpend)} invert bars={s.map(spendOf)} />
        <KpiCard label="Views" value={formatCompact(k.views)} delta={pct(k.views, p.views)} bars={s.map((r) => r.views)} />
        <KpiCard label="Published" value={published} delta={pct(published, prevPublished)} bars={s.map((r) => r.posts)} href="/library" />
        {showConversions ? (
          <KpiCard label="Ad conversions" value={formatCompact(k.ad_conversions)} delta={pct(k.ad_conversions, p.ad_conversions)} bars={s.map((r) => num(r.ad_spend_usd))} href="/paid" />
        ) : (
          <KpiCard label="Cost per 1k views" value={k.views > 0 ? formatUsd(per1k(totalSpend, k.views)) : "—"} delta={k.views > 0 && p.views > 0 ? pct(per1k(totalSpend, k.views), per1k(prevSpend, p.views)) : null} invert bars={s.map((r) => per1k(spendOf(r), r.views))} />
        )}
      </div>

      {/* Main chart + breakdown */}
      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          label="Views over time"
          value={formatCompact(views)}
          footer={metrics && metrics.sampled_videos > 0 ? <p className="text-[12px] text-fg-faint">{metrics.sampled_videos} videos sampled in the last {metrics.days} days.</p> : undefined}
        >
          {views === 0 && prevViews === 0 ? (
            <Quiet>No views sampled in this window yet. Metrics arrive a few hours after a post goes live.</Quiet>
          ) : (
            <LineChart
              height={230}
              xLabels={labels}
              series={[{ label: `Last ${days} days`, values: s.map((r) => r.views), kind: "current" }, ...(prev && prevViews > 0 ? [{ label: `Previous ${days} days`, values: prev.map((r) => r.views), kind: "compare" as const }] : [])]}
            />
          )}
        </ChartCard>
        <SpendBreakdown overview={o} spend={spend} ads={ads} playbooks={playbooks} />
      </div>

      {/* Three smaller cards */}
      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard label="Top content">
          {o.top_content.length === 0 ? (
            <Quiet>Your best pieces show up here once posts collect views.</Quiet>
          ) : (
            <BarList
              rows={o.top_content.slice(0, 5).map((c) => ({
                label: c.title,
                href: hrefFor(c.kind, c.id),
                amount: c.views ?? 0,
                value: c.views != null ? formatCompact(c.views) : "—",
                count: c.platform ? PLATFORM[c.platform] ?? c.platform : undefined,
                leading: <ToolIcon tone={TOOL_ICON[c.kind === "article" ? "seo" : "content"].tone} size={14}>{TOOL_ICON[c.kind === "article" ? "seo" : "content"].icon}</ToolIcon>,
              }))}
            />
          )}
        </ChartCard>
        <ChartCard label="Spend over time" value={usd(totalSpend)}>
          {totalSpend === 0 ? <Quiet>No spend in this window.</Quiet> : <LineChart height={150} xLabels={labels} format={(n) => `$${formatCompact(n)}`} series={[{ label: "Spend", values: s.map(spendOf), kind: "current" }, ...(prev ? [{ label: "Previous", values: prev.map(spendOf), kind: "compare" as const }] : [])]} />}
        </ChartCard>
        <ChartCard label="Posts over time" value={published}>
          {published === 0 ? <Quiet>Nothing published in this window.</Quiet> : <LineChart height={150} xLabels={labels} series={[{ label: "Posts", values: s.map((r) => r.posts), kind: "current" }, ...(prev ? [{ label: "Previous", values: prev.map((r) => r.posts), kind: "compare" as const }] : [])]} />}
        </ChartCard>
      </div>

      <Pipeline overview={o} ads={ads} />
      <PlaybookTable playbooks={playbooks} />
    </>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-[12.5px] text-fg-muted">{children}</p>;
}

/** Right of the main chart (ref 05 "Total sales breakdown"): where the money went. */
function SpendBreakdown({ overview: o, spend, ads, playbooks }: { overview: Overview; spend: SpendHistory | null; ads: AdsOverview | null; playbooks: PlaybookPerformance[] }) {
  const content = num(o.kpis.content_spend_usd);
  const adSpend = num(o.kpis.ad_spend_usd);
  const titles = new Map(playbooks.map((pb) => [pb.id, pb.title]));
  const byPlaybook = new Map<string, { v: number; days: Map<string, number> }>();
  for (const r of spend?.rows ?? []) {
    const key = r.niche_id || "other";
    const e = byPlaybook.get(key) ?? { v: 0, days: new Map() };
    e.v += num(r.cost_usd);
    e.days.set(r.day, (e.days.get(r.day) ?? 0) + num(r.cost_usd));
    byPlaybook.set(key, e);
  }
  const rows = [...byPlaybook.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 4);
  return (
    <ChartCard label="Spend breakdown">
      <BreakdownList
        rows={[
          { label: "Content production", value: formatUsd(content), trend: bucket(o.series.map((r) => num(r.content_spend_usd))), href: "/content" },
          { label: "Paid media", value: formatUsd(adSpend), trend: bucket(o.series.map((r) => num(r.ad_spend_usd))), href: "/paid" },
          ...rows.map(([id, e]) => ({ label: titles.get(id) ?? (id === "other" ? "Other" : "Untitled playbook"), value: formatUsd(e.v), trend: bucket(o.series.map((r) => e.days.get(r.day.slice(0, 10)) ?? 0)), href: id === "other" ? undefined : `/playbooks/${id}` })),
          { label: "Total", value: formatUsd(content + adSpend), total: true },
        ]}
      />
    </ChartCard>
  );
}

function Pipeline({ overview: o, ads }: { overview: Overview; ads: AdsOverview | null }) {
  const pa = o.pipeline.ads;
  const pendingAds = ads?.pending_approvals ?? pa.pending_approvals;
  const live = ads?.active_campaigns ?? pa.active_campaigns;
  const row = (dept: "content" | "seo", label: string, href: string, x: { done: number; active: number; failed: number }, fixQ: string) => ({ dept, label, href, ...x, fixQ });
  const rows = [
    row("content", "Videos & carousels", "/content", o.pipeline.content, "Why did my last videos fail, and can you fix them?"),
    row("seo", "Articles", "/seo", o.pipeline.seo, "Why did my last articles fail, and can you retry them?"),
  ];
  return (
    <section className="pt-5">
      <div className="mb-2 px-0.5">
        <DataLabel icon={<RefreshCw />} action={<Link href="/activity" className="text-[12px] text-fg-muted hover:text-fg">Activity</Link>}>Pipeline</DataLabel>
      </div>
      <Table
        rowKey={(r) => r.label}
        rowHref={(r) => r.href}
        rows={[...rows, { dept: "paid" as const, label: "Paid media", href: "/paid", done: live, active: 0, failed: 0, fixQ: "" }]}
        columns={[
          { key: "l", label: "Work", render: (r) => <span className="flex items-center gap-2.5"><ToolIcon tone={TOOL_ICON[r.dept].tone}>{TOOL_ICON[r.dept].icon}</ToolIcon>{r.label}</span> },
          { key: "d", label: "Done", align: "right", render: (r) => (r.dept === "paid" ? `${r.done} live` : r.done) },
          { key: "a", label: "In progress", align: "right", hideOnPhone: true, render: (r) => (r.dept === "paid" ? "—" : r.active) },
          {
            key: "s",
            label: "Status",
            align: "right",
            render: (r) =>
              r.dept === "paid" ? (
                pendingAds > 0 ? <StatusBadge tone="attention">{pendingAds} to approve</StatusBadge> : <StatusBadge>All clear</StatusBadge>
              ) : r.failed > 0 ? (
                <Link href={askHref(r.fixQ, r.dept)} className="relative z-10">
                  <StatusBadge tone="negative">{r.failed} failed · Fix</StatusBadge>
                </Link>
              ) : (
                <StatusBadge>All clear</StatusBadge>
              ),
          },
        ]}
      />
    </section>
  );
}

function PlaybookTable({ playbooks }: { playbooks: PlaybookPerformance[] }) {
  const rows = playbooks.filter((pb) => pb.summary && pb.summary.total_videos > 0).sort((a, b) => (b.summary!.total_views ?? 0) - (a.summary!.total_views ?? 0));
  if (rows.length === 0) return null;
  return (
    <section className="pt-5">
      <div className="mb-2 px-0.5">
        <DataLabel icon={<BarChart3 />}>By playbook</DataLabel>
      </div>
      <Table
        rowKey={(r) => r.id}
        rowHref={(r) => `/playbooks/${r.id}`}
        rows={rows}
        columns={[
          { key: "t", label: "Playbook", render: (r) => <span className="block max-w-[260px] truncate">{r.title}</span> },
          { key: "v", label: "Videos", align: "right", hideOnPhone: true, render: (r) => r.summary!.total_videos },
          { key: "w", label: "Views", align: "right", render: (r) => formatCompact(r.summary!.total_views) },
          { key: "a", label: "Avg / video", align: "right", hideOnPhone: true, render: (r) => formatCompact(r.summary!.avg_views_per_video) },
          { key: "s", label: "Spend", align: "right", hideOnPhone: true, render: (r) => formatUsd(num(r.summary!.total_spend_usd)) },
          { key: "k", label: "Per 1k views", align: "right", render: (r) => (r.summary!.total_views > 0 ? formatUsd(per1k(num(r.summary!.total_spend_usd), r.summary!.total_views)) : "—") },
        ]}
      />
    </section>
  );
}
