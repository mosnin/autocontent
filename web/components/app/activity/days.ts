"use client";

import { useEffect, useState } from "react";

/**
 * Day bucketing that never causes a hydration mismatch: the server and the
 * first client render bucket in UTC, then the client re-buckets in the
 * viewer's own timezone after mount. Shared by Activity and Plan; could be
 * promoted to lib/ if another page needs it.
 */
export function useLocalTime(): boolean {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);
  return local;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD of an instant, in UTC or the viewer's timezone. */
export function dayKey(d: Date | string, local: boolean): string {
  const t = typeof d === "string" ? new Date(d) : d;
  return local ? `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` : t.toISOString().slice(0, 10);
}

/** Midnight UTC of a YYYY-MM-DD key (calendar math stays timezone-free). */
export function keyDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export function addDays(key: string, n: number): string {
  const d = keyDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  return keyDate(key).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

/** "Today", "Yesterday", "Tomorrow", a weekday this week, or "Mar 4". */
export function relativeDayLabel(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === addDays(today, -1)) return "Yesterday";
  if (key === addDays(today, 1)) return "Tomorrow";
  const diff = Math.round((keyDate(key).getTime() - keyDate(today).getTime()) / 86400_000);
  if (Math.abs(diff) < 7) return formatKey(key, { weekday: "long" });
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return formatKey(key, { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatTime(iso: string, local: boolean): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(local ? {} : { timeZone: "UTC" }) });
}
