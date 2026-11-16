import { Activity as ActivityIcon, ArrowUpRight, BarChart3, LineChart, PieChart, TrendingUp, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AdsOverview } from "@/lib/ads-client";
import { departmentById } from "@/lib/departments";
import { formatCompact, formatUsd } from "@/lib/format";
import type { PerformanceSummary, SpendHistory } from "@/lib/types";
import { hrefFor, type Overview, type SeriesRow } from "@/lib/workspace";
import { PageBody, PageHeader, PageIntro, Stat, TitledCard } from "../page";
import { cx } from "../cx";
import { AgentAvatar, Badge, ButtonLink, Delta, Empty, Sparkbars } from "../ui";
import { platformLabel } from "../plan/plan-data";
import { askHref, AskWhy } from "./ask";
import { type Period, PeriodSelect } from "./period-select";
import { TrendChart, TrendLegend } from "./trend-chart";

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
}

const analyst = departmentById("analytics")!;
const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const periodWord = (d: number) => (d === 7 ? "this week" : `in the last ${d} days`);
const per1k = (spend: number, views: number) => (views > 0 ? (spend / views) * 1000 : 0);

function summary(o: Overview, days: number): string {
  const k = o.kpis;
  const p = o.previous_kpis;
  const parts: string[] = [];
  if (p.views > 0) {
    const pct = Math.round(((k.views - p.views) / p.views) * 100);
    parts.push(`Views ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% ${periodWord(days)}.`);
  } else if (k.views > 0) parts.push(`${formatCompact(k.views)} views ${periodWord(days)}.`);
  const total = num(k.total_spend_usd);
  if (total > 0) {
    const adShare = Math.round((num(k.ad_spend_usd) / total) * 100);
    parts.push(`${formatUsd(total, { cents: false })} spent, ${adShare}% of it on ads.`);
  }
  parts.push(`${k.posts_published} post${k.posts_published === 1 ? "" : "s"} and ${k.articles_published} article${k.articles_published === 1 ? "" : "s"} went out.`);
  return parts.join(" ");
}

export function AnalyticsView(data: AnalyticsData) {
  const { days, overview: o } = data;
  return (
    <>
      <PageHeader icon={<BarChart3 />} title="Analytics">
        <PeriodSelect value={days} />
        <ButtonLink href={askHref()} size="sm" className="hidden pl-1.5 sm:inline-flex">
          <AgentAvatar name={analyst.agentName} palette={analyst.palette} size={20} />
          Ask the Analyst
        </ButtonLink>
      </PageHeader>
      <PageBody width="6xl" className="pb-6">
        {!o ? (
          <Empty art="activity" title="Couldn't load your numbers">The API didn't answer. Try again in a moment, or ask the Analyst once it's back.</Empty>
        ) : (
          <Body {...data} overview={o} />
        )}
        <AskPill />
      </PageBody>
    </>
  );
}

function Body({ days, overview: o, previousSeries, spend, ads, metrics, playbooks }: AnalyticsData & { overview: Overview }) {
  const k = o.kpis;
  const p = o.previous_kpis;
  const s = o.series;
  const totalSpend = num(k.total_spend_usd);
  const prevSpend = num(p.total_spend_usd);
  const showConversions = k.ad_conversions > 0 || p.ad_conversions > 0;
  const nothingYet = totalSpend === 0 && k.views === 0 && k.posts_published === 0 && k.articles_published === 0;

  return (
    <div className="t-stagger space-y-3">
      <PageIntro title={days === 7 ? "Last 7 days" : `Last ${days} days`} className="mb-5">
        {nothingYet ? "Nothing has gone out in this window yet. Once posts start collecting views, this is where you see what moved." : summary(o, days)}
      </PageIntro>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={<Label q={`Why did total spend change ${periodWord(days)}?`}>Total spend</Label>}
          value={formatUsd(totalSpend, { cents: totalSpend < 100 })}
          delta={<Delta now={totalSpend} before={prevSpend} invert />}
          spark={<Sparkbars values={s.map((r) => num(r.content_spend_usd) + num(r.ad_spend_usd))} className="hidden sm:flex" />}
        />
        <Stat
          label={<Label q={`What drove views ${periodWord(days)}?`}>Views</Label>}
          value={formatCompact(k.views)}
          delta={<Delta now={k.views} before={p.views} />}
          spark={<Sparkbars values={s.map((r) => r.views)} className="hidden sm:flex" />}
        />
        <Stat
          label={<Label q={`Are we publishing enough? Compare posts ${periodWord(days)} to before.`}>Posts published</Label>}
          value={k.posts_published + k.articles_published}
          delta={<Delta now={k.posts_published + k.articles_published} before={p.posts_published + p.articles_published} />}
          spark={<Sparkbars values={s.map((r) => r.posts)} className="hidden sm:flex" />}
        />
        {showConversions ? (
          <Stat
            label={<Label q="Which ads are driving conversions, and what's our cost per conversion?">Ad conversions</Label>}
            value={formatCompact(k.ad_conversions)}
            delta={<Delta now={k.ad_conversions} before={p.ad_conversions} />}
            spark={<Sparkbars values={s.map((r) => num(r.ad_spend_usd))} className="hidden sm:flex" />}
          />
        ) : (
          <Stat
            label={<Label q="Compare organic and paid cost per 1k views">Cost per 1k views</Label>}
            value={k.views > 0 ? formatUsd(per1k(totalSpend, k.views)) : "—"}
            delta={k.views > 0 && p.views > 0 ? <Delta now={per1k(totalSpend, k.views)} before={per1k(prevSpend, p.views)} invert /> : undefined}
            spark={<Sparkbars values={s.map((r) => per1k(num(r.content_spend_usd) + num(r.ad_spend_usd), r.views))} className="hidden sm:flex" />}
          />
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ViewsCard days={days} series={s} previous={previousSeries} metrics={metrics} />
        <SpendCard overview={o} spend={spend} ads={ads} playbooks={playbooks} />
        <TopContent overview={o} days={days} />
        <PipelineHealth overview={o} ads={ads} />
      </div>

      {playbooks.some((pb) => pb.summary && pb.summary.total_videos > 0) && <PlaybookTable playbooks={playbooks} days={days} />}
    </div>
  );
}

function Label({ children, q }: { children: ReactNode; q: string }) {
  return (
    <span className="flex items-center gap-2">
      {children}
      <AskWhy q={q} label="" className="opacity-70" />
    </span>
  );
}

function ViewsCard({ days, series, previous, metrics }: { days: number; series: SeriesRow[]; previous: SeriesRow[] | null; metrics: MetricsSummary | null }) {
  const total = series.reduce((a, r) => a + r.views, 0);
  const prevTotal = previous?.reduce((a, r) => a + r.views, 0) ?? 0;
  const hasPrev = Boolean(previous && previous.length === series.length && prevTotal > 0);
  return (
    <TitledCard
      className="lg:col-span-2"
      icon={<LineChart />}
      title="Views over time"
      action={<AskWhy q={`Explain the views trend ${periodWord(days)}: what spiked, what dipped and why`} />}
      footer={metrics && metrics.sampled_videos > 0 ? `Views gained per day across organic video. ${metrics.sampled_videos} videos sampled in the last ${metrics.days} days.` : "Views gained per day across organic video."}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-medium tracking-[-0.02em] tabular">{formatCompact(total)}</span>
          {hasPrev && <Delta now={total} before={prevTotal} />}
          <span className="text-[13px] text-muted-foreground">views gained</span>
        </div>
        {hasPrev && <TrendLegend />}
      </div>
      {total === 0 && prevTotal === 0 ? (
        <p className="rounded-[14px] bg-subtle px-4 py-10 text-center text-[13px] text-muted-foreground">No views sampled in this window yet. Metrics arrive a few hours after a post goes live.</p>
      ) : (
        <TrendChart current={series.map((r) => ({ day: r.day, value: r.views }))} previous={hasPrev ? previous!.map((r) => r.views) : null} />
      )}
    </TitledCard>
  );
}

function SpendCard({ overview: o, spend, ads, playbooks }: { overview: Overview; spend: SpendHistory | null; ads: AdsOverview | null; playbooks: PlaybookPerformance[] }) {
  const content = num(o.kpis.content_spend_usd);
  const adSpend = num(o.kpis.ad_spend_usd);
  const total = content + adSpend;
  const contentPct = total > 0 ? (content / total) * 100 : 0;
  const titles = new Map(playbooks.map((pb) => [pb.id, pb.title]));
  const byPlaybook = new Map<string, number>();
  for (const r of spend?.rows ?? []) {
    const key = r.niche_id || "other";
    byPlaybook.set(key, (byPlaybook.get(key) ?? 0) + num(r.cost_usd));
  }
  const rows = [...byPlaybook.entries()].map(([id, v]) => ({ id, title: titles.get(id) ?? (id === "other" ? "Other" : "Untitled playbook"), v })).sort((a, b) => b.v - a.v);
  const top = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((a, r) => a + r.v, 0);
  if (rest > 0) top.push({ id: "_rest", title: `${rows.length - 5} more`, v: rest });
  const maxRow = Math.max(1, ...top.map((r) => r.v));

  return (
    <TitledCard icon={<PieChart />} title="Spend breakdown" action={<AskWhy q="Where are we wasting spend?" />}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[28px] font-medium tracking-[-0.02em] tabular">{formatUsd(total, { cents: total < 100 })}</span>
        <span className="text-[13px] text-muted-foreground">total</span>
      </div>
      {total > 0 ? (
        <>
          <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`Content ${contentPct.toFixed(0)}%, ads ${(100 - contentPct).toFixed(0)}%`}>
            {content > 0 && <span className="h-full rounded-full bg-foreground/75" style={{ width: `${contentPct}%` }} />}
            {adSpend > 0 && <span className="h-full flex-1 rounded-full bg-accent" />}
          </div>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-foreground/75" />
              <dt className="text-muted-foreground">Content production</dt>
              <dd className="ml-auto tabular">{formatUsd(content)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-accent" />
              <dt className="text-muted-foreground">Paid media</dt>
              <dd className="ml-auto tabular">{formatUsd(adSpend)}</dd>
            </div>
            {ads && ads.active_campaigns > 0 && (
              <div className="pl-4 text-[12px] text-faint">
                {ads.active_campaigns} live campaign{ads.active_campaigns === 1 ? "" : "s"} · {formatUsd(ads.spend_today_usd)} today
              </div>
            )}
          </dl>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">No spend in this window.</p>
      )}
      {top.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[12px] text-faint">Content spend by playbook</div>
          <ul className="space-y-2.5">
            {top.map((r) => (
              <li key={r.id} className="text-[13px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="shrink-0 text-muted-foreground tabular">{formatUsd(r.v)}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground/60" style={{ width: `${Math.max(2, (r.v / maxRow) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TitledCard>
  );
}

function TopContent({ overview: o, days }: { overview: Overview; days: number }) {
  const items = o.top_content.slice(0, 6);
  const max = Math.max(1, ...items.map((c) => c.views ?? 0));
  return (
    <TitledCard className="lg:col-span-2" icon={<TrendingUp />} title="Top content" action={items.length > 0 ? <AskWhy q={`What do my top pieces ${periodWord(days)} have in common, and what should we make next?`} /> : undefined}>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Your best-performing pieces show up here once posts start collecting views.</p>
      ) : (
        <ul className="-mx-2">
          {items.map((c, i) => (
            <li key={`${c.kind}-${c.id}`}>
              <Link href={hrefFor(c.kind, c.id)} className="press group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <span className="w-4 shrink-0 text-right text-[12px] text-faint tabular">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[14px]">{c.title}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1 flex-1 rounded-full bg-muted">
                      {c.views != null && <span className={cx("block h-full rounded-full", i === 0 ? "bg-accent" : "bg-foreground/40")} style={{ width: `${Math.max(2, (c.views / max) * 100)}%` }} />}
                    </span>
                  </span>
                </span>
                <span className="w-24 shrink-0 text-right text-[12px] text-muted-foreground">
                  <span className="block tabular text-[13px] text-foreground">{c.views != null ? formatCompact(c.views) : "—"}</span>
                  <span className="capitalize">{c.kind}{c.platform ? ` · ${platformLabel(c.platform)}` : ""}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TitledCard>
  );
}

function HealthRow({ label, href, done, active, failed, fixQ, dept }: { label: string; href: string; done: number; active: number; failed: number; fixQ: string; dept: "content" | "seo" }) {
  const total = done + active + failed;
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <Link href={href} className="text-[14px] font-medium hover:underline">{label}</Link>
        {failed > 0 ? <Badge tone="danger">{failed} failed</Badge> : active > 0 ? <Badge tone="live">{active} in progress</Badge> : <span className="text-[12px] text-faint">All clear</span>}
      </div>
      <div className="mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-muted">
        {total > 0 && (
          <>
            {done > 0 && <span className="h-full rounded-full bg-floor" style={{ width: `${(done / total) * 100}%` }} />}
            {active > 0 && <span className="h-full rounded-full bg-accent/60" style={{ width: `${(active / total) * 100}%` }} />}
            {failed > 0 && <span className="h-full rounded-full bg-destructive" style={{ width: `${(failed / total) * 100}%` }} />}
          </>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground tabular">
        <span>{done} done</span>
        <span>{active} active</span>
        <span>{failed} failed</span>
        {failed > 0 && (
          <Link href={askHref(fixQ, dept)} className="ml-auto inline-flex items-center gap-1 text-accent hover:underline [&_svg]:size-3">
            <Wrench aria-hidden />
            Fix
          </Link>
        )}
      </div>
    </li>
  );
}

function PipelineHealth({ overview: o, ads }: { overview: Overview; ads: AdsOverview | null }) {
  const pa = o.pipeline.ads;
  const pending = ads?.pending_approvals ?? pa.pending_approvals;
  const live = ads?.active_campaigns ?? pa.active_campaigns;
  return (
    <TitledCard icon={<ActivityIcon />} title="Pipeline health" action={<Link href="/activity" className="text-[13px] text-muted-foreground hover:text-foreground">Activity</Link>}>
      <ul className="-mt-1 divide-y divide-border">
        <HealthRow label="Videos & carousels" href="/content" dept="content" {...o.pipeline.content} fixQ="Why did my last videos fail, and can you fix them?" />
        <HealthRow label="Articles" href="/seo" dept="seo" {...o.pipeline.seo} fixQ="Why did my last articles fail, and can you retry them?" />
        <li className="flex items-center justify-between gap-2 py-2.5">
          <Link href="/paid" className="text-[14px] font-medium hover:underline">Paid media</Link>
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground tabular">
            {live} live
            {pending > 0 && (
              <Link href="/inbox" className="inline-flex">
                <Badge tone="warn">{pending} to approve</Badge>
              </Link>
            )}
          </span>
        </li>
      </ul>
    </TitledCard>
  );
}

function PlaybookTable({ playbooks, days }: { playbooks: PlaybookPerformance[]; days: number }) {
  const rows = playbooks.filter((pb) => pb.summary && pb.summary.total_videos > 0).sort((a, b) => (b.summary!.total_views ?? 0) - (a.summary!.total_views ?? 0));
  return (
    <TitledCard icon={<BarChart3 />} title="By playbook" action={<AskWhy q={`Which playbook is most efficient ${periodWord(days)}, and where should we shift budget?`} />}>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-y border-border text-left text-[12px] text-faint">
              <th className="px-4 py-2 font-normal">Playbook</th>
              <th className="px-4 py-2 text-right font-normal">Videos</th>
              <th className="px-4 py-2 text-right font-normal">Views</th>
              <th className="px-4 py-2 text-right font-normal">Avg / video</th>
              <th className="px-4 py-2 text-right font-normal">Spend</th>
              <th className="px-4 py-2 text-right font-normal">Per 1k views</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((pb) => {
              const s = pb.summary!;
              const sp = num(s.total_spend_usd);
              return (
                <tr key={pb.id}>
                  <td className="max-w-[220px] truncate px-4 py-2.5">
                    <Link href={`/playbooks/${pb.id}`} className="hover:underline">{pb.title}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{s.total_videos}</td>
                  <td className="px-4 py-2.5 text-right tabular">{formatCompact(s.total_views)}</td>
                  <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{formatCompact(s.avg_views_per_video)}</td>
                  <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{formatUsd(sp)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{s.total_views > 0 ? formatUsd(per1k(sp, s.total_views)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TitledCard>
  );
}

/** The floating "Ask the Analyst" pill, bottom centre of the page. */
function AskPill() {
  return (
    <div className="pointer-events-none sticky bottom-5 z-20 mt-8 flex justify-center">
      <Link
        href={askHref()}
        className="press pointer-events-auto flex h-11 items-center gap-2.5 rounded-full border border-border bg-card pl-1.5 pr-4 text-[14px] font-medium shadow-float hover:bg-subtle dark:bg-muted"
      >
        <AgentAvatar name={analyst.agentName} palette={analyst.palette} size={30} />
        Ask the Analyst
        <span className="hidden text-[13px] font-normal text-muted-foreground sm:inline">what moved and why</span>
      </Link>
    </div>
  );
}
