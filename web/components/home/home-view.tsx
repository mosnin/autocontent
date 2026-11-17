import { CalendarRange, Clapperboard, FileText, GalleryHorizontal, History, Inbox as InboxIcon, Megaphone, PackageCheck } from "lucide-react";
import Link from "next/link";
import { Backdrop, Bullet, GlassCard, Heatmap, StatBlock, WorkspaceLogo } from "@/design-system";
import { formatCompact, formatRelative, formatUsd } from "@/lib/format";
import { hrefFor, type Activity, type Inbox, type Overview } from "@/lib/workspace";
import { StartSession } from "../chat/start-session";
import { RecentSessions } from "./recent-sessions";

const KIND_ICON: Record<string, React.ReactNode> = {
  video: <Clapperboard className="size-3.5" />,
  carousel: <GalleryHorizontal className="size-3.5" />,
  article: <FileText className="size-3.5" />,
  ad_action: <Megaphone className="size-3.5" />,
  approval: <Megaphone className="size-3.5" />,
  campaign: <CalendarRange className="size-3.5" />,
};

function pct(now: number, before: number) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

function DeltaText({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value == null) return null;
  const good = invert ? value < 0 : value > 0;
  return <span className={good ? "text-positive" : "text-negative"}>{value > 0 ? `+${value}` : value}%</span>;
}

/**
 * Home (ref 01): shader light behind a centered brand and one large composer,
 * then a bento of glass cards that answer "what happened, what's waiting,
 * how's the month".
 */
export function HomeView({ brandName = "Marketer", month, history, inbox, activity }: { brandName?: string; month: Overview | null; history: Overview | null; inbox: Inbox | null; activity: Activity | null }) {
  const k = month?.kpis;
  const pk = month?.previous_kpis;
  const days = (history?.series ?? month?.series ?? []).map((r) => ({ date: r.day, value: r.posts }));
  const posts = days.reduce((s, d) => s + d.value, 0);
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const monthName = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) : "");
  const shipped = (activity?.events ?? []).filter((e) => e.status === "done" || e.status === "running").slice(0, 3);
  const waiting = inbox?.counts.total ?? 0;

  return (
    <Backdrop palette="dusk">
      <div className="mx-auto max-w-[1000px] px-5 pb-16 pt-[12vh] sm:px-6">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-5 flex items-center gap-2.5">
            <WorkspaceLogo name={brandName} size={26} />
            <h1 className="text-[26px] font-medium tracking-[-0.02em]">{brandName}</h1>
          </div>
          <StartSession size="hero" autoFocus />
        </div>

        <div className="mt-16 grid gap-3 md:grid-cols-12">
          <GlassCard className="md:col-span-5" title="Activity" icon={<PackageCheck />}>
            {days.length > 0 ? (
              <Heatmap days={days.slice(-182)} caption={`${posts} posts published${month ? ` · ${month.kpis.articles_published} articles` : ""}`} range={first && last ? `${monthName(first)} – ${monthName(last)}` : undefined} />
            ) : (
              <p className="text-[13px] text-fg-muted">Posts appear here as they go out.</p>
            )}
          </GlassCard>

          <GlassCard className="md:col-span-7" title="Recent sessions" icon={<History />}>
            <RecentSessions />
          </GlassCard>

          <GlassCard className="md:col-span-2" title="Waiting" icon={<InboxIcon />}>
            <Link href="/inbox" className="block">
              <div className="text-[28px] font-medium leading-none tabular">{waiting}</div>
              <div className="mt-1.5 text-[12.5px] text-fg-muted">{waiting === 1 ? "needs your yes" : "need your yes"}</div>
            </Link>
          </GlassCard>

          <GlassCard className="md:col-span-6" title="What shipped" icon={<PackageCheck />} footer={activity && activity.events.length > 3 ? <Link href="/activity" className="hover:text-fg">{activity.events.length - 3} more</Link> : undefined}>
            {shipped.length > 0 ? (
              <ul className="space-y-3">
                {shipped.map((e) => (
                  <li key={e.id}>
                    <Link href={hrefFor(e.kind, e.ref_id)} className="flex gap-2.5 hover:opacity-90">
                      <span className="mt-0.5 text-positive">{KIND_ICON[e.kind]}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{e.title}</span>
                        <span className="block text-[12px] text-fg-muted">
                          {formatRelative(e.at)} · {e.detail}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-fg-muted">Finished videos, articles and ad changes show up here.</p>
            )}
          </GlassCard>

          <GlassCard className="md:col-span-4" title="This month" icon={<CalendarRange />}>
            <div className="space-y-4">
              <StatBlock label="Views" value={formatCompact(k?.views ?? 0)} delta={<DeltaText value={pct(k?.views ?? 0, pk?.views ?? 0)} />} />
              <div className="grid grid-cols-2 gap-3">
                <StatBlock tone="fg" label="Posts" value={k?.posts_published ?? 0} delta={<DeltaText value={pct(k?.posts_published ?? 0, pk?.posts_published ?? 0)} />} />
                <StatBlock tone="fg" label="Spend" value={formatUsd(k?.total_spend_usd ?? 0, { cents: false })} />
              </div>
            </div>
          </GlassCard>
        </div>

      </div>
    </Backdrop>
  );
}
