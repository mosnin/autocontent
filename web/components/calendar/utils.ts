// Grouping + formatting helpers for the agenda-style calendar. All date
// math is done in the viewer's local timezone (posting windows carry an
// absolute instant; we bucket them by the local calendar day so "Today"
// means today where the marketer is sitting). No date library — native
// Date + Intl only.
import type { CalendarItem } from "./types";

export interface DayGroup {
  /** Stable local-day key, e.g. "2026-07-15". */
  key: string;
  /** Midnight (local) of the group's day. */
  date: Date;
  /** Primary heading: "Today", "Tomorrow", or the weekday name. */
  label: string;
  /** Secondary heading, e.g. "Wed, Jul 15". */
  sub: string;
  isToday: boolean;
  items: CalendarItem[];
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const weekdayLongFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * Bucket items into chronologically-ordered day groups. Items within a
 * day are ordered earliest-first; empty days are omitted (the agenda is
 * intentionally sparse).
 */
export function groupByDay(items: CalendarItem[]): DayGroup[] {
  const sorted = [...items].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  const buckets = new Map<string, CalendarItem[]>();
  for (const item of sorted) {
    const key = localDayKey(new Date(item.at));
    const arr = buckets.get(key);
    if (arr) arr.push(item);
    else buckets.set(key, [item]);
  }

  const todayKey = localDayKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = localDayKey(tomorrow);

  const groups: DayGroup[] = [];
  for (const [key, groupItems] of buckets) {
    // `${key}T00:00:00` (no zone suffix) parses as local midnight.
    const date = new Date(`${key}T00:00:00`);
    const isToday = key === todayKey;
    let label = weekdayLongFmt.format(date);
    if (isToday) label = "Today";
    else if (key === tomorrowKey) label = "Tomorrow";

    groups.push({
      key,
      date,
      label,
      sub: dateFmt.format(date),
      isToday,
      items: groupItems,
    });
  }

  // Map preserves insertion order (already chronological via `sorted`).
  return groups;
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** "3 videos and 1 article" style count phrase (handles singular/plural). */
export function summarize(items: CalendarItem[]): {
  videos: number;
  articles: number;
  phrase: string;
} {
  const videos = items.filter((i) => i.kind === "video").length;
  const articles = items.length - videos;
  const vLabel = `${videos} ${videos === 1 ? "video" : "videos"}`;
  const aLabel = `${articles} ${articles === 1 ? "article" : "articles"}`;
  return { videos, articles, phrase: `${vLabel} and ${aLabel}` };
}
