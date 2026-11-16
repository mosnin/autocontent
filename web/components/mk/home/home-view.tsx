import { ArrowUpRight, BarChart3, CircleDot, History, Inbox as InboxIcon, TrendingUp } from "lucide-react";
import Link from "next/link";
import { StartSession } from "../agent/start-session";
import { Greeting } from "./greeting";
import { RecentSessions } from "./recent-sessions";
import { InboxRow } from "../inbox/inbox-row";
import { PageBody, TitledCard } from "../page";
import { AgentAvatar, Delta, Sparkbars } from "../ui";
import { DEPARTMENTS } from "@/lib/departments";
import { formatCompact, formatUsd } from "@/lib/format";
import { hrefFor, type Inbox, type Overview } from "@/lib/workspace";

function summaryLine(needs: number, viewsNow: number, viewsBefore: number, posts: number): string {
  const parts: string[] = [];
  parts.push(needs === 0 ? "Nothing needs you right now." : `${needs} thing${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} you.`);
  if (viewsBefore > 0) {
    const pct = Math.round(((viewsNow - viewsBefore) / viewsBefore) * 100);
    parts.push(`Views ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% this week.`);
  } else if (posts > 0) parts.push(`${posts} post${posts === 1 ? "" : "s"} went out this week.`);
  else parts.push("Ask Marketer for your first piece of content.");
  return parts.join(" ");
}

export function HomeView({ week, month, inbox }: { week: Overview | null; month: Overview | null; inbox: Inbox | null }) {
  const k = week?.kpis;
  const pk = week?.previous_kpis;
  const needs = inbox?.counts.total ?? 0;
  const failed = (month?.pipeline.content.failed ?? 0) + (month?.pipeline.seo.failed ?? 0);

  const suggestions = [
    needs > 0 ? "Walk me through what's waiting on me" : null,
    failed > 0 ? "Why did my last pieces fail, and can you fix them?" : null,
    (month?.kpis.posts_published ?? 0) > 0 ? "What worked best this month, and what should we make next?" : "Plan my first week of content",
    "Turn my best video into a carousel and an article",
    (month?.pipeline.ads.active_campaigns ?? 0) > 0 ? "Should we scale or pause any ads?" : "Should I be running ads yet?",
  ].filter((s): s is string => Boolean(s)).slice(0, 4);

  const views = (week?.series ?? []).map((r) => r.views);
  const spend = (week?.series ?? []).map((r) => Number(r.content_spend_usd) + Number(r.ad_spend_usd));
  const posts = (week?.series ?? []).map((r) => r.posts);

  return (
    <PageBody width="5xl">
      <div className="t-stagger space-y-5">
        <Greeting summary={summaryLine(needs, k?.views ?? 0, pk?.views ?? 0, k?.posts_published ?? 0)} />
        <StartSession suggestions={suggestions} autoFocus />

        <div className="grid gap-3 pt-3 md:grid-cols-5">
          <TitledCard
            className="md:col-span-3"
            icon={<InboxIcon />}
            title="Awaiting you"
            action={needs > 0 ? <Link href="/inbox" className="text-[13px] text-muted-foreground hover:text-foreground">See all {needs}</Link> : undefined}
          >
            {inbox && inbox.items.length > 0 ? (
              <div className="-mx-4 divide-y divide-border border-t border-border">
                {inbox.items.slice(0, 4).map((it) => (
                  <InboxRow key={it.id} item={it} />
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">You're clear. When something needs a yes before it posts or spends, it shows up here.</p>
            )}
          </TitledCard>

          <TitledCard className="md:col-span-2" icon={<History />} title="Recent sessions">
            <RecentSessions />
          </TitledCard>

          <TitledCard className="md:col-span-2" icon={<BarChart3 />} title="This week" action={<Link href="/analytics" className="text-[13px] text-muted-foreground hover:text-foreground">Analytics</Link>}>
            <dl className="space-y-3.5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <dt className="text-[13px] text-muted-foreground">Views</dt>
                  <dd className="flex items-baseline gap-2">
                    <span className="text-[24px] font-medium tracking-[-0.02em] tabular text-accent">{formatCompact(k?.views ?? 0)}</span>
                    <Delta now={k?.views ?? 0} before={pk?.views ?? 0} />
                  </dd>
                </div>
                <Sparkbars values={views} />
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <dt className="text-[13px] text-muted-foreground">Posts published</dt>
                  <dd className="flex items-baseline gap-2">
                    <span className="text-[24px] font-medium tracking-[-0.02em] tabular">{k?.posts_published ?? 0}</span>
                    <Delta now={k?.posts_published ?? 0} before={pk?.posts_published ?? 0} />
                  </dd>
                </div>
                <Sparkbars values={posts} />
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <dt className="text-[13px] text-muted-foreground">Spend</dt>
                  <dd className="flex items-baseline gap-2">
                    <span className="text-[24px] font-medium tracking-[-0.02em] tabular">{formatUsd(k?.total_spend_usd ?? 0)}</span>
                    <Delta now={Number(k?.total_spend_usd ?? 0)} before={Number(pk?.total_spend_usd ?? 0)} invert />
                  </dd>
                </div>
                <Sparkbars values={spend} />
              </div>
            </dl>
          </TitledCard>

          <TitledCard className="md:col-span-3" icon={<TrendingUp />} title="What moved">
            {month && month.top_content.length > 0 ? (
              <ul className="-mx-2">
                {month.top_content.slice(0, 5).map((c) => (
                  <li key={`${c.kind}-${c.id}`}>
                    <Link href={hrefFor(c.kind, c.id)} className="press flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                      <span className="w-16 shrink-0 text-[12px] capitalize text-faint">{c.kind}</span>
                      <span className="min-w-0 flex-1 truncate text-[14px]">{c.title}</span>
                      <span className="shrink-0 text-[13px] text-muted-foreground tabular">{c.views != null ? `${formatCompact(c.views)} views` : c.platform ?? ""}</span>
                      <ArrowUpRight className="size-3.5 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Your best-performing pieces show up here once posts start collecting views.</p>
            )}
          </TitledCard>
        </div>

        <TitledCard icon={<CircleDot />} title="Departments">
          <div className="-mx-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {DEPARTMENTS.map((d) => {
              const status =
                d.id === "content" && month
                  ? `${month.pipeline.content.active} waiting · ${month.pipeline.content.done} done${month.pipeline.content.failed ? ` · ${month.pipeline.content.failed} failed` : ""}`
                  : d.id === "seo" && month
                    ? `${month.pipeline.seo.done} articles · ${month.pipeline.seo.active} waiting`
                    : d.id === "paid" && month
                      ? `${month.pipeline.ads.active_campaigns} live · ${month.pipeline.ads.pending_approvals} to approve`
                      : d.id === "analytics" && month
                        ? `${formatCompact(month.kpis.views)} views in 30 days`
                        : d.summary.split(",")[0];
              return (
                <Link key={d.id} href={d.href} className="press flex items-center gap-3 rounded-[14px] px-3 py-2.5 hover:bg-muted/60">
                  <AgentAvatar name={d.agentName} palette={d.palette} size={30} />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{d.label}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">{status}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </TitledCard>
      </div>
    </PageBody>
  );
}
