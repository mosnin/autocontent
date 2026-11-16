"use client";

import { Activity as ActivityIcon, ArrowLeft, Clapperboard, FileText, GalleryHorizontal, Megaphone, Rocket, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { formatRelative, titleCase } from "@/lib/format";
import { type Activity, type ActivityEvent, type ActivityKind, hrefFor } from "@/lib/workspace";
import { List, PageBody, PageHeader, PageIntro, SectionTitle } from "../page";
import { Badge, ButtonLink, Chip, Dot, Empty, IconTile } from "../ui";
import { dayKey, formatTime, relativeDayLabel, useLocalTime } from "./days";

const ICON: Record<ActivityKind, ReactNode> = {
  video: <Clapperboard />,
  carousel: <GalleryHorizontal />,
  article: <FileText />,
  ad_action: <Megaphone />,
  approval: <ShieldCheck />,
  campaign: <Rocket />,
};

const KIND_LABEL: Record<ActivityKind, string> = {
  video: "Video",
  carousel: "Carousel",
  article: "Article",
  ad_action: "Ad change",
  approval: "Approval",
  campaign: "Campaign",
};

type Filter = "all" | "video" | "carousel" | "article" | "ads" | "campaign";
const FILTERS: { value: Filter; label: string; kinds: ActivityKind[] }[] = [
  { value: "all", label: "All", kinds: [] },
  { value: "video", label: "Videos", kinds: ["video"] },
  { value: "carousel", label: "Carousels", kinds: ["carousel"] },
  { value: "article", label: "Articles", kinds: ["article"] },
  { value: "ads", label: "Paid media", kinds: ["ad_action", "approval"] },
  { value: "campaign", label: "Campaigns", kinds: ["campaign"] },
];

const FAILED = new Set(["failed", "error", "errored"]);
const REJECTED = new Set(["rejected", "declined", "cancelled", "canceled"]);
const PENDING = new Set(["pending", "awaiting_approval", "needs_approval"]);
const DONE = new Set(["done", "approved", "posted", "published", "completed", "succeeded", "applied", "ready"]);
const LIVE = new Set(["running", "active", "queued", "ideating", "scripting", "generating_images", "animating", "voicing", "editing", "captioning", "qa", "scheduling", "researching", "outlining", "writing", "rendering", "planning", "generating"]);

function StatusMark({ e }: { e: ActivityEvent }) {
  const s = e.status.toLowerCase();
  if (FAILED.has(s)) return <Badge tone="danger">Failed</Badge>;
  if (REJECTED.has(s)) return <Badge>{titleCase(s)}</Badge>;
  if (PENDING.has(s)) return <Badge tone="warn">Needs you</Badge>;
  if (LIVE.has(s))
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Dot tone="live" />
        {s === "running" || s === "active" ? "Running" : titleCase(s)}
      </span>
    );
  if (DONE.has(s)) return null;
  // Ad actions carry the verb as their status (pause, budget_change…).
  return <span className="text-[12px] text-faint">{titleCase(s)}</span>;
}

function EventRow({ e, local, isToday }: { e: ActivityEvent; local: boolean; isToday: boolean }) {
  const s = e.status.toLowerCase();
  return (
    <Link href={hrefFor(e.kind, e.ref_id)} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/50">
      <IconTile tone={LIVE.has(s) && (s === "running" || s === "active") ? "live" : "muted"}>{ICON[e.kind] ?? <ActivityIcon />}</IconTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{e.title}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {KIND_LABEL[e.kind] ?? titleCase(e.kind)}
          {e.detail && <span> · {e.detail}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
        <StatusMark e={e} />
        <time dateTime={e.at} suppressHydrationWarning className="whitespace-nowrap text-[12px] text-faint tabular">
          {isToday ? formatRelative(e.at) : formatTime(e.at, local)}
        </time>
      </span>
    </Link>
  );
}

export function ActivityView({ activity, before, basePath = "/activity" }: { activity: Activity | null; before?: string | null; basePath?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const local = useLocalTime();
  const events = useMemo(() => activity?.events ?? [], [activity]);

  const counts = useMemo(() => {
    const m = new Map<Filter, number>();
    for (const f of FILTERS) m.set(f.value, f.value === "all" ? events.length : events.filter((e) => f.kinds.includes(e.kind)).length);
    return m;
  }, [events]);

  const groups = useMemo(() => {
    const kinds = FILTERS.find((f) => f.value === filter)!.kinds;
    const shown = filter === "all" ? events : events.filter((e) => kinds.includes(e.kind));
    const out: { key: string; events: ActivityEvent[] }[] = [];
    for (const e of shown) {
      const key = dayKey(e.at, local);
      const last = out[out.length - 1];
      if (last?.key === key) last.events.push(e);
      else out.push({ key, events: [e] });
    }
    return out;
  }, [events, filter, local]);

  const today = dayKey(new Date(), local);
  const failed = events.filter((e) => FAILED.has(e.status.toLowerCase())).length;
  const pending = events.filter((e) => PENDING.has(e.status.toLowerCase())).length;

  return (
    <>
      <PageHeader icon={<ActivityIcon />} title="Activity">
        {before && (
          <ButtonLink href={basePath} size="sm" variant="ghost">
            <ArrowLeft />
            Latest
          </ButtonLink>
        )}
      </PageHeader>
      <PageBody width="4xl">
        <PageIntro title={before ? "Earlier activity" : "What happened"}>
          {!activity
            ? "Everything every department did, newest first."
            : [
                "Everything every department did, newest first.",
                pending > 0 ? `${pending} waiting on you.` : null,
                failed > 0 ? `${failed} failed and can be retried.` : null,
              ]
                .filter(Boolean)
                .join(" ")}
        </PageIntro>

        {!activity ? (
          <Empty art="activity" title="Couldn't load activity">The API didn't answer. Try again in a moment.</Empty>
        ) : events.length === 0 ? (
          <Empty art="activity" title={before ? "Nothing earlier" : "No activity yet"} action={<ButtonLink href={before ? basePath : "/sessions/new"} variant="primary">{before ? "Back to latest" : "Ask Marketer to make something"}</ButtonLink>}>
            {before ? "You've reached the beginning." : "Videos, articles, ad changes and approvals show up here as departments work."}
          </Empty>
        ) : (
          <>
            <div role="group" aria-label="Filter by kind" className="-mx-5 mb-6 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
              {FILTERS.filter((f) => f.value === "all" || (counts.get(f.value) ?? 0) > 0).map((f) => (
                <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)} className="shrink-0">
                  {f.label}
                  <span className="text-faint tabular">{counts.get(f.value)}</span>
                </Chip>
              ))}
            </div>

            {groups.length === 0 ? (
              <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">Nothing of this kind on this page. Load older activity or pick another filter.</p>
            ) : (
              <div className="t-stagger space-y-7">
                {groups.map((g) => (
                  <section key={g.key}>
                    <SectionTitle action={<span className="text-[12px] text-faint tabular">{g.events.length}</span>}>
                      <span suppressHydrationWarning>{relativeDayLabel(g.key, today)}</span>
                    </SectionTitle>
                    <List>
                      {g.events.map((e) => (
                        <EventRow key={e.id} e={e} local={local} isToday={g.key === today} />
                      ))}
                    </List>
                  </section>
                ))}
              </div>
            )}

            <div className="mt-8 flex justify-center">
              {activity.next_before ? (
                <ButtonLink href={`${basePath}?before=${encodeURIComponent(activity.next_before)}`}>Load older</ButtonLink>
              ) : (
                <span className="text-[13px] text-faint">That's everything.</span>
              )}
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
