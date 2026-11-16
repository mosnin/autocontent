"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clapperboard, FileText, GalleryHorizontal, Megaphone, Rocket } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { departmentById } from "@/lib/departments";
import { StartSession } from "../agent/start-session";
import { addDays, dayKey, formatKey, formatTime, useLocalTime } from "../activity/days";
import { PageBody, PageHeader, PageIntro, SectionTitle } from "../page";
import { ButtonLink, cx, Dot, Segmented } from "../ui";
import { KIND_LABEL, type PlanItem, type PlanKind, type PlanMode, planHref, platformLabel } from "./plan-data";

const ICON: Record<PlanKind, ReactNode> = {
  video: <Clapperboard />,
  carousel: <GalleryHorizontal />,
  article: <FileText />,
  ad: <Megaphone />,
  campaign: <Rocket />,
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dist = departmentById("distribution")!;

function statusDot(status: string) {
  const s = status.toLowerCase();
  if (s === "awaiting_approval" || s === "pending") return <Dot tone="warn" label="Needs your approval" />;
  if (s === "failed") return <Dot tone="danger" label="Failed" />;
  return null;
}
const isDone = (s: string) => ["done", "posted", "published", "completed"].includes(s.toLowerCase());

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function summarize(items: PlanItem[]): string {
  if (items.length === 0) return "";
  const by = (k: PlanKind) => items.filter((i) => i.kind === k).length;
  const parts = [
    by("video") && plural(by("video"), "video"),
    by("carousel") && plural(by("carousel"), "carousel"),
    by("article") && plural(by("article"), "article"),
    by("ad") && plural(by("ad"), "ad campaign"),
    by("campaign") && plural(by("campaign"), "campaign"),
  ].filter(Boolean) as string[];
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* --------------------------------------------------------------- item rows */

function Meta({ item }: { item: PlanItem }) {
  const bits = [platformLabel(item.platform), item.playbook].filter(Boolean);
  return bits.length ? <span className="block truncate text-[11px] text-muted-foreground">{bits.join(" · ")}</span> : null;
}

/** A small row: time, kind icon, title, platform · playbook. */
function ItemRow({ item, local, roomy }: { item: PlanItem; local: boolean; roomy?: boolean }) {
  return (
    <Link
      href={planHref(item)}
      title={`${KIND_LABEL[item.kind]}: ${item.title}`}
      className={cx("press group flex gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/70", isDone(item.status) && "opacity-55", roomy && "items-center gap-3 px-3 py-2")}
    >
      <span className={cx("mt-[2px] flex shrink-0 text-muted-foreground [&_svg]:size-3.5", roomy && "mt-0")}>{ICON[item.kind]}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span suppressHydrationWarning className="text-[11px] text-faint tabular">{formatTime(item.at, local)}</span>
          {statusDot(item.status)}
        </span>
        <span className={cx("block text-[13px] leading-snug", roomy ? "truncate" : "line-clamp-2")}>{item.title}</span>
        <Meta item={item} />
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------- views */

function DayHead({ k, today, compact }: { k: string; today: string; compact?: boolean }) {
  const isToday = k === today;
  return (
    <div className={cx("flex items-center gap-1.5", compact ? "text-[12px]" : "text-[13px]")}>
      <span className="text-muted-foreground">{formatKey(k, { weekday: "short" })}</span>
      <span className={cx("inline-flex size-6 items-center justify-center rounded-full tabular", isToday ? "bg-accent font-medium text-accent-foreground" : "text-foreground")}>{Number(k.slice(8))}</span>
      {isToday && <span className="text-[12px] text-accent">Today</span>}
    </div>
  );
}

function WeekView({ days, byDay, today, local }: { days: string[]; byDay: Map<string, PlanItem[]>; today: string; local: boolean }) {
  return (
    <div className="grid gap-2 lg:grid-cols-7">
      {days.map((k) => {
        const items = byDay.get(k) ?? [];
        const past = k < today;
        return (
          <section
            key={k}
            aria-label={formatKey(k, { weekday: "long", month: "long", day: "numeric" })}
            className={cx(
              "flex min-w-0 flex-col rounded-[14px] border p-1.5 lg:min-h-[280px]",
              k === today ? "border-accent/30 bg-accent/[0.03]" : "border-border bg-card",
              past && k !== today && "bg-subtle",
              // Phones: empty days are a quiet line, not a card.
              items.length === 0 && k !== today && "max-lg:border-transparent max-lg:bg-transparent max-lg:py-0",
            )}
          >
            <div className="flex items-center justify-between px-1.5 pb-1 pt-0.5">
              <DayHead k={k} today={today} />
              {items.length > 0 && <span className="text-[11px] text-faint tabular lg:hidden">{items.length}</span>}
            </div>
            {items.length > 0 ? (
              <div className="space-y-0.5">
                {items.map((it) => (
                  <ItemRow key={`${it.kind}-${it.id}`} item={it} local={local} />
                ))}
              </div>
            ) : (
              <span className="px-2 pb-1 text-[12px] text-faint lg:hidden">Nothing scheduled</span>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MonthView({ days, anchor, byDay, today, local }: { days: string[]; anchor: string; byDay: Map<string, PlanItem[]>; today: string; local: boolean }) {
  const month = anchor.slice(0, 7);
  const withItems = days.filter((k) => k.startsWith(month) && (byDay.get(k)?.length ?? 0) > 0);
  return (
    <>
      <div className="hidden overflow-hidden rounded-[14px] border border-border bg-border md:block">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-subtle px-2.5 py-1.5 text-[12px] text-muted-foreground">
              {d}
            </div>
          ))}
          {days.map((k) => {
            const items = byDay.get(k) ?? [];
            const inMonth = k.startsWith(month);
            const isToday = k === today;
            return (
              <div key={k} className={cx("flex min-h-[112px] min-w-0 flex-col gap-0.5 p-1", inMonth ? "bg-card" : "bg-subtle", isToday && "bg-accent/[0.04]")}>
                <span className={cx("ml-1 mt-0.5 inline-flex size-6 items-center justify-center rounded-full text-[12px] tabular", isToday ? "bg-accent font-medium text-accent-foreground" : inMonth ? "text-foreground" : "text-faint")}>{Number(k.slice(8))}</span>
                {items.slice(0, 3).map((it) => (
                  <Link
                    key={`${it.kind}-${it.id}`}
                    href={planHref(it)}
                    title={`${formatTime(it.at, local)} · ${it.title}${it.playbook ? ` · ${it.playbook}` : ""}`}
                    className={cx("press flex items-center gap-1.5 rounded-[6px] px-1.5 py-[3px] text-[12px] hover:bg-muted", isDone(it.status) && "opacity-55")}
                  >
                    <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3">{ICON[it.kind]}</span>
                    <span className="min-w-0 flex-1 truncate">{it.title}</span>
                    {statusDot(it.status)}
                  </Link>
                ))}
                {items.length > 3 && <span className="px-1.5 text-[11px] text-muted-foreground">+{items.length - 3} more</span>}
              </div>
            );
          })}
        </div>
      </div>
      {/* Phones: the month as an agenda of the days that have something. */}
      <div className="space-y-5 md:hidden">
        {withItems.length === 0 ? (
          <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">Nothing scheduled this month.</p>
        ) : (
          withItems.map((k) => (
            <section key={k}>
              <SectionTitle>
                <DayHead k={k} today={today} compact />
              </SectionTitle>
              <div className="rounded-[14px] border border-border bg-card p-1">
                {(byDay.get(k) ?? []).map((it) => (
                  <ItemRow key={`${it.kind}-${it.id}`} item={it} local={local} roomy />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- page */

export function PlanView({
  items,
  mode,
  offset,
  start,
  days: dayCount,
  anchor,
  loadError,
}: {
  items: PlanItem[];
  mode: PlanMode;
  offset: number;
  /** First day shown (YYYY-MM-DD, UTC). */
  start: string;
  days: number;
  /** Week: its Monday. Month: the 1st. */
  anchor: string;
  loadError?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const local = useLocalTime();
  const today = dayKey(new Date(), local);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(start, i)), [start, dayCount]);

  const byDay = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of [...items].sort((a, b) => a.at.localeCompare(b.at))) {
      const k = dayKey(it.at, local);
      const arr = m.get(k);
      if (arr) arr.push(it);
      else m.set(k, [it]);
    }
    return m;
  }, [items, local]);

  const visible = mode === "month" ? items.filter((it) => dayKey(it.at, local).startsWith(anchor.slice(0, 7))) : items.filter((it) => days.includes(dayKey(it.at, local)));
  const upcomingEmpty = days.filter((k) => k >= today && (byDay.get(k)?.length ?? 0) === 0).length;
  const waiting = visible.filter((it) => statusDot(it.status) && it.status.toLowerCase() !== "failed").length;

  const title =
    mode === "week"
      ? offset === 0
        ? "This week"
        : offset === 1
          ? "Next week"
          : offset === -1
            ? "Last week"
            : `Week of ${formatKey(anchor, { month: "short", day: "numeric" })}`
      : formatKey(anchor, { month: "long", year: "numeric" });

  const sentence = loadError
    ? "Couldn't load the schedule. The API didn't answer; try again in a moment."
    : visible.length === 0
      ? `Nothing scheduled ${mode === "week" ? "this week" : "this month"}. Ask the Distribution manager to fill it.`
      : [
          `${plural(visible.length, "thing")} going out: ${summarize(visible)}.`,
          waiting > 0 ? `${waiting} need${waiting === 1 ? "s" : ""} your approval first.` : null,
          upcomingEmpty > 0 && offset >= 0 ? `${plural(upcomingEmpty, "day")} still open.` : null,
        ]
          .filter(Boolean)
          .join(" ");

  const suggestions = [
    upcomingEmpty > 0 && offset >= 0 ? `Fill the ${plural(upcomingEmpty, "open day")} ${mode === "week" ? (offset === 0 ? "this week" : "that week") : "this month"}` : null,
    mode === "week" && offset === 0 ? "What's going out this week?" : `What's planned for ${title.toLowerCase().startsWith("week") ? title.toLowerCase() : title}?`,
    waiting > 0 ? "Walk me through what needs my approval" : "Balance posts across TikTok, Reels and Shorts",
    "When is the best time to post for my audience?",
  ].filter((s): s is string => Boolean(s));

  const href = (o: number, m: PlanMode = mode) => `${pathname}?view=${m}${o ? `&offset=${o}` : ""}`;

  return (
    <>
      <PageHeader icon={<CalendarDays />} title="Plan">
        <Segmented label="View" className="w-[124px]" value={mode} onChange={(m) => router.push(href(0, m), { scroll: false })} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      </PageHeader>
      <PageBody width="6xl">
        <PageIntro
          title={title}
          action={
            <div className="flex items-center gap-1">
              <ButtonLink href={href(offset - 1)} size="icon" variant="ghost" aria-label={`Previous ${mode}`} title={`Previous ${mode}`}>
                <ChevronLeft />
              </ButtonLink>
              <ButtonLink href={href(0)} size="sm" variant={offset === 0 ? "ghost" : "secondary"} aria-disabled={offset === 0}>
                Today
              </ButtonLink>
              <ButtonLink href={href(offset + 1)} size="icon" variant="ghost" aria-label={`Next ${mode}`} title={`Next ${mode}`}>
                <ChevronRight />
              </ButtonLink>
            </div>
          }
        >
          {sentence}
        </PageIntro>

        <div className="t-stagger flex flex-col gap-8">
          {mode === "week" ? <WeekView days={days} byDay={byDay} today={today} local={local} /> : <MonthView days={days} anchor={anchor} byDay={byDay} today={today} local={local} />}

          {/* An empty stretch puts the ask first: filling it is the next step. */}
          <section className={cx(visible.length === 0 && "order-first")}>
            <SectionTitle>Ask the {dist.agentName}</SectionTitle>
            <StartSession scope="distribution" lockScope suggestions={suggestions.slice(0, 4)} />
          </section>
        </div>
      </PageBody>
    </>
  );
}
