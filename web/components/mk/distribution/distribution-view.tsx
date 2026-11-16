import { CalendarDays, Send } from "lucide-react";
import Link from "next/link";
import { StartSession } from "../agent/start-session";
import { PageBody, PageHeader, PageIntro, SectionTitle, TitledCard } from "../page";
import { ButtonLink, Dot } from "../ui";
import { CampaignsSection } from "./campaigns";
import { Channels } from "./channels";
import { departmentById } from "@/lib/departments";
import type { CalendarItem, PlaybookRef } from "@/lib/business";
import type { AyrshareConnectStatus, Campaign } from "@/lib/types";

const PLATFORM: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts" };
const KIND: Record<string, string> = { video: "Video", article: "Article", ad: "Ad" };

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function itemHref(it: CalendarItem): string {
  if (it.kind === "video") return `/content/videos/${it.id}`;
  if (it.kind === "article") return `/seo/${it.id}`;
  if (it.kind === "ad") return `/paid/campaigns/${it.id}`;
  return "/plan";
}

/** A compact week: what's going out, grouped by day. The full calendar lives on Plan. */
export function ThisWeek({ items, playbooks }: { items: CalendarItem[] | null; playbooks: PlaybookRef[] }) {
  if (items === null) return <p className="text-[13px] text-muted-foreground">The calendar is out of reach right now.</p>;
  const now = Date.now();
  const week = items.filter((i) => {
    const t = new Date(i.at).getTime();
    return t >= now - 3600_000 && t <= now + 7 * 86400_000;
  }).sort((a, b) => a.at.localeCompare(b.at));
  if (week.length === 0) return <p className="text-[13px] text-muted-foreground">Nothing scheduled in the next seven days. Ask the Distribution manager to fill the week.</p>;
  const pb = Object.fromEntries(playbooks.map((p) => [p.id, p.title]));
  const groups: [string, CalendarItem[]][] = [];
  for (const it of week.slice(0, 8)) {
    const k = dayKey(it.at);
    const g = groups.find(([key]) => key === k);
    if (g) g[1].push(it);
    else groups.push([k, [it]]);
  }
  return (
    <div className="space-y-3">
      {groups.map(([k, list]) => (
        <div key={k}>
          <div className="mb-1 text-[12px] text-faint">{k}</div>
          <ul className="-mx-2">
            {list.map((it) => (
              <li key={`${it.kind}-${it.id}`}>
                <Link href={itemHref(it)} className="press flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60">
                  <span className="w-12 shrink-0 text-[12px] text-muted-foreground tabular">{new Date(it.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  {it.status === "awaiting_approval" ? <Dot tone="warn" label="Needs you" /> : <Dot tone="muted" />}
                  <span className="min-w-0 flex-1 truncate text-[14px]">{it.title}</span>
                  <span className="hidden shrink-0 text-[12px] text-faint sm:inline">
                    {it.platform ? PLATFORM[it.platform] ?? it.platform : KIND[it.kind] ?? it.kind}
                    {pb[it.niche_id] ? ` · ${pb[it.niche_id]}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DistributionView({
  ayrshare,
  campaigns,
  calendar,
  playbooks,
}: {
  ayrshare: AyrshareConnectStatus | null;
  campaigns: Campaign[] | null;
  calendar: CalendarItem[] | null;
  playbooks: PlaybookRef[];
}) {
  const dept = departmentById("distribution")!;
  return (
    <>
      <PageHeader icon={<Send />} title="Distribution">
        <ButtonLink href="/plan" size="sm" variant="ghost">
          <CalendarDays /> Plan
        </ButtonLink>
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro title="Where everything goes out">{dept.summary}</PageIntro>
        <div className="t-stagger space-y-8">
          <StartSession scope="distribution" lockScope suggestions={dept.asks} />

          <div className="grid gap-3 md:grid-cols-5">
            <section className="min-w-0 md:col-span-3">
              <SectionTitle action={<Link href="/integrations" className="text-[13px] text-muted-foreground hover:text-foreground">All integrations</Link>}>Channels</SectionTitle>
              <Channels status={ayrshare} />
            </section>
            <TitledCard className="md:col-span-2" icon={<CalendarDays />} title="This week" action={<Link href="/plan" className="text-[13px] text-muted-foreground hover:text-foreground">Open plan</Link>}>
              <ThisWeek items={calendar} playbooks={playbooks} />
            </TitledCard>
          </div>

          <section>
            <SectionTitle>Campaigns · content, SEO and ads in one push</SectionTitle>
            {campaigns === null ? (
              <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">We couldn't load your campaigns right now. Refresh in a moment.</p>
            ) : (
              <CampaignsSection campaigns={campaigns} hasPlaybooks={playbooks.length > 0} />
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}
