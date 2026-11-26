"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AskPill, Bullet, ButtonLink, Canvas, Card, cx, FilterPill, Notice, PageHeader, Segmented, Toolbar, ToolIcon } from "@/design-system";
import { TOOL_ICON } from "@/components/shell/sidebar";
import type { DepartmentId } from "@/lib/departments";
import { addDays, dayKey, formatKey, formatTime, useLocalTime } from "../activity/days";
import { KIND_LABEL, type PlanItem, type PlanKind, type PlanMode, planHref, platformLabel } from "./plan-data";
import { type Reschedule, useReschedule } from "./reschedule";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEPT: Record<PlanKind, DepartmentId> = { video: "content", carousel: "content", article: "seo", ad: "paid", campaign: "distribution" };

const isWaiting = (s: string) => ["awaiting_approval", "pending"].includes(s.toLowerCase());
const isFailed = (s: string) => s.toLowerCase() === "failed";
const isDone = (s: string) => ["done", "posted", "published", "completed"].includes(s.toLowerCase());
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Mark({ status }: { status: string }) {
  if (isWaiting(status)) return <Bullet tone="attention" />;
  if (isFailed(status)) return <Bullet tone="negative" />;
  return null;
}

/** One scheduled item: tool icon, time, title (12px). */
function Item({ item, local, showTime = true, rs }: { item: PlanItem; local: boolean; showTime?: boolean; rs?: Reschedule }) {
  const tool = TOOL_ICON[DEPT[item.kind]];
  const meta = [platformLabel(item.platform), item.playbook].filter(Boolean).join(" · ");
  const dragging = rs?.draggingId === item.id;
  return (
    <Link
      href={planHref(item)}
      title={`${KIND_LABEL[item.kind]}: ${item.title}${meta ? ` · ${meta}` : ""}${item.movable ? " · drag to another day" : ""}`}
      {...(rs?.dragProps(item) ?? {})}
      className={cx(
        "ds-press flex min-w-0 items-center gap-1.5 rounded-ds-xs px-1 py-[3px] text-[12px] hover:bg-surface-2",
        isDone(item.status) && "opacity-60",
        item.movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <ToolIcon tone={tool.tone} size={14}>
        {tool.icon}
      </ToolIcon>
      {showTime && (
        <span suppressHydrationWarning className="shrink-0 text-fg-faint tabular">
          {formatTime(item.at, local)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <Mark status={item.status} />
    </Link>
  );
}

/** A day cell's drop highlight while an item is dragged over it. */
const dropCls = (rs: Reschedule | undefined, k: string) => cx("transition-[background-color,box-shadow] duration-150", rs?.overDay === k && "bg-ds-accent/10 ring-1 ring-inset ring-ds-accent/50");

function DayNumber({ k, today, faint }: { k: string; today: string; faint?: boolean }) {
  const isToday = k === today;
  return <span className={cx("inline-flex size-5 items-center justify-center rounded-full text-[12px] tabular", isToday ? "bg-ds-accent font-medium text-on-fill" : faint ? "text-fg-faint" : "text-fg-muted")}>{Number(k.slice(8))}</span>;
}

/** Desktop: 7 columns with hairline borders. Phones: one row per day. */
function WeekGrid({ days, byDay, today, local, rs }: { days: string[]; byDay: Map<string, PlanItem[]>; today: string; local: boolean; rs?: Reschedule }) {
  return (
    <div className="grid divide-y divide-hairline md:grid-cols-7 md:divide-x md:divide-y-0">
      {days.map((k, i) => {
        const items = byDay.get(k) ?? [];
        return (
          <section key={k} aria-label={formatKey(k, { weekday: "long", month: "long", day: "numeric" })} {...(rs?.dropProps(k) ?? {})} className={cx("flex min-w-0 flex-col gap-0.5 p-1.5 md:min-h-[360px]", k < today && "bg-surface-2/40", dropCls(rs, k))}>
            <div className="flex items-center gap-1.5 px-1 pb-1">
              <span className="text-[12px] text-fg-faint">{WEEKDAYS[i]}</span>
              <DayNumber k={k} today={today} />
            </div>
            {items.map((it) => (
              <Item key={`${it.kind}-${it.id}`} item={it} local={local} rs={rs} />
            ))}
            {items.length === 0 && <span className="px-1 text-[12px] text-fg-faint md:hidden">Nothing scheduled</span>}
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({ days, anchor, byDay, today, local, rs }: { days: string[]; anchor: string; byDay: Map<string, PlanItem[]>; today: string; local: boolean; rs?: Reschedule }) {
  const month = anchor.slice(0, 7);
  const withItems = days.filter((k) => k.startsWith(month) && (byDay.get(k)?.length ?? 0) > 0);
  return (
    <>
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-hairline">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={cx("px-2.5 py-1.5 text-[12px] text-fg-faint", i > 0 && "border-l border-hairline")}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((k, i) => {
            const items = byDay.get(k) ?? [];
            const inMonth = k.startsWith(month);
            return (
              <div key={k} {...(rs?.dropProps(k) ?? {})} className={cx("flex min-h-[104px] min-w-0 flex-col gap-0.5 p-1", i % 7 > 0 && "border-l border-hairline", i >= 7 && "border-t border-hairline", !inMonth && "bg-surface-2/40", dropCls(rs, k))}>
                <span className="px-0.5 pb-0.5">
                  <DayNumber k={k} today={today} faint={!inMonth} />
                </span>
                {items.slice(0, 3).map((it) => (
                  <Item key={`${it.kind}-${it.id}`} item={it} local={local} showTime={false} rs={rs} />
                ))}
                {items.length > 3 && <span className="px-1 text-[12px] text-fg-faint">+{items.length - 3} more</span>}
              </div>
            );
          })}
        </div>
      </div>
      {/* Phones: the month as an agenda of the days that have something. */}
      <div className="divide-y divide-hairline md:hidden">
        {withItems.length === 0 ? (
          <p className="px-3.5 py-6 text-[13px] text-fg-muted">Nothing scheduled this month.</p>
        ) : (
          withItems.map((k) => (
            <section key={k} className="p-1.5">
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <span className="text-[12px] text-fg-faint">{formatKey(k, { weekday: "short" })}</span>
                <DayNumber k={k} today={today} />
              </div>
              {(byDay.get(k) ?? []).map((it) => (
                <Item key={`${it.kind}-${it.id}`} item={it} local={local} />
              ))}
            </section>
          ))
        )}
      </div>
    </>
  );
}

/** Plan (ref 05): toolbar, a calendar card of everything scheduled, and an ask pill. */
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
  const [channel, setChannel] = useState("all");
  const rs = useReschedule();
  const apply = rs.apply;
  const all = useMemo(() => apply(items), [apply, items]);
  const today = dayKey(new Date(), local);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(start, i)), [start, dayCount]);

  const channels = useMemo(() => [...new Set(all.map((i) => i.platform).filter((p): p is string => Boolean(p)))], [all]);
  const shown = useMemo(() => (channel === "all" ? all : all.filter((i) => i.platform === channel)), [all, channel]);

  const byDay = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of [...shown].sort((a, b) => a.at.localeCompare(b.at))) {
      const k = dayKey(it.at, local);
      const arr = m.get(k);
      if (arr) arr.push(it);
      else m.set(k, [it]);
    }
    return m;
  }, [shown, local]);

  const visible = mode === "month" ? shown.filter((it) => dayKey(it.at, local).startsWith(anchor.slice(0, 7))) : shown.filter((it) => days.includes(dayKey(it.at, local)));
  const open = days.filter((k) => k >= today && (mode === "week" || k.startsWith(anchor.slice(0, 7))) && (byDay.get(k)?.length ?? 0) === 0).length;
  const waiting = visible.filter((it) => isWaiting(it.status)).length;

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

  const summary = loadError
    ? "Couldn't load the schedule. Try again in a moment."
    : [plural(visible.length, "item"), waiting > 0 ? `${waiting} need${waiting === 1 ? "s" : ""} approval` : null, open > 0 && offset >= 0 ? `${plural(open, "open day")}` : null].filter(Boolean).join(" · ");

  const href = (o: number, m: PlanMode = mode) => `${pathname}?view=${m}${o ? `&offset=${o}` : ""}`;
  const askText = open > 0 && offset >= 0 ? `Fill the ${plural(open, "open day")} ${mode === "week" ? (offset === 0 ? "this week" : `in the week of ${formatKey(anchor, { month: "short", day: "numeric" })}`) : `in ${title}`}` : `What's planned for ${title.toLowerCase().startsWith("this") || title.toLowerCase().endsWith("week") ? title.toLowerCase() : title}?`;

  return (
    <>
      <PageHeader icon={<CalendarDays />} title="Plan" />
      <Toolbar
        end={
          <>
            <ButtonLink href={href(offset - 1)} variant="ghost" size="md" aria-label={`Previous ${mode}`} title={`Previous ${mode}`} className="w-7 px-0">
              <ChevronLeft />
            </ButtonLink>
            <ButtonLink href={href(0)} variant="secondary" size="md" aria-disabled={offset === 0}>
              Today
            </ButtonLink>
            <ButtonLink href={href(offset + 1)} variant="ghost" size="md" aria-label={`Next ${mode}`} title={`Next ${mode}`} className="w-7 px-0">
              <ChevronRight />
            </ButtonLink>
          </>
        }
      >
        <Segmented label="View" value={mode} onChange={(m) => router.push(href(0, m), { scroll: false })} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <FilterPill label="Channel" value={channel} onChange={setChannel} options={[{ value: "all", label: "All channels" }, ...channels.map((c) => ({ value: c, label: platformLabel(c) ?? c }))]} />
      </Toolbar>
      <Canvas>
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-hairline px-3.5 py-2.5">
            <h2 className="text-[14px] font-medium">{title}</h2>
            <span suppressHydrationWarning className="text-[12px] text-fg-faint">
              {summary}
            </span>
          </div>
          {rs.error && (
            <div className="border-b border-hairline px-3.5 py-2">
              <Notice error={rs.error} />
            </div>
          )}
          {mode === "week" ? <WeekGrid days={days} byDay={byDay} today={today} local={local} rs={rs} /> : <MonthGrid days={days} anchor={anchor} byDay={byDay} today={today} local={local} rs={rs} />}
        </Card>
        <AskPill label="Ask Marketer to fill the gaps" href={`/sessions/new?dept=distribution&q=${encodeURIComponent(askText)}`} />
      </Canvas>
    </>
  );
}
