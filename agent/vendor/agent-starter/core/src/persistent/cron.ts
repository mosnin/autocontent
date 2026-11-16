import { AgentError } from "../errors.ts";

/**
 * Minimal 5-field cron (minute hour day-of-month month day-of-week) for persistent-agent schedules. Supports `*`,
 * numbers, lists (`1,15`), ranges (`1-5`) and steps (`*\/15`, `0-30/10`). Day-of-week is 0-6 (Sunday = 0; 7 is also
 * Sunday). As in Vixie cron, when both day-of-month and day-of-week are restricted a day matches if either does.
 * No names (`MON`, `JAN`) and no `@hourly` macros: keep schedules explicit.
 *
 * Time zones are honoured through `Intl.DateTimeFormat` wall-clock parts. Across DST changes a local time that does
 * not exist is skipped and a repeated local hour may fire once per occurrence.
 */
export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const FIELDS: Array<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

function invalid(expr: string, why: string): AgentError {
  return new AgentError("CONFIG_INVALID", `Invalid cron "${expr.slice(0, 80)}": ${why}`);
}

function parseField(expr: string, text: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const [rangeText = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : /^\d{1,2}$/.test(stepText) ? Number(stepText) : Number.NaN;
    if (!Number.isInteger(step) || step < 1) throw invalid(expr, `bad step in ${name}`);
    let lo: number;
    let hi: number;
    if (rangeText === "*") {
      lo = min;
      hi = max;
    } else if (/^\d{1,2}-\d{1,2}$/.test(rangeText)) {
      [lo, hi] = rangeText.split("-").map(Number) as [number, number];
    } else if (/^\d{1,2}$/.test(rangeText)) {
      lo = Number(rangeText);
      hi = stepText === undefined ? lo : max;
    } else throw invalid(expr, `bad ${name} "${rangeText}"`);
    if (lo < min || hi > max || lo > hi) throw invalid(expr, `${name} out of range`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw invalid(expr, "expected 5 fields");
  const sets = parts.map((p, i) => parseField(expr, p, (FIELDS[i] as { min: number }).min, (FIELDS[i] as { max: number }).max, (FIELDS[i] as { name: string }).name));
  const dow = sets[4] as Set<number>;
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return {
    minute: sets[0] as Set<number>,
    hour: sets[1] as Set<number>,
    dayOfMonth: sets[2] as Set<number>,
    month: sets[3] as Set<number>,
    dayOfWeek: dow,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Local wall-clock parts of an instant in `tz` (UTC when omitted). */
export function wallClock(at: number, tz?: string): WallClock {
  if (!tz || tz === "UTC") {
    const d = new Date(at);
    return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
  }
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    formatters.set(tz, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(at))) parts[p.type] = p.value;
  return { month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAYS[parts.weekday ?? "Sun"] ?? 0 };
}

function dayMatches(spec: CronSpec, w: WallClock): boolean {
  if (!spec.month.has(w.month)) return false;
  const dom = spec.dayOfMonth.has(w.day);
  const dow = spec.dayOfWeek.has(w.weekday);
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  if (spec.domRestricted) return dom;
  if (spec.dowRestricted) return dow;
  return true;
}

const MINUTE = 60_000;

/**
 * The next instant (epoch ms, on a minute boundary) strictly after `from` at which `cron` fires in `tz`.
 * Throws for an invalid expression or when nothing fires within ~4 years (e.g. `0 0 31 2 *`).
 */
export function nextScheduleFire(cron: string | CronSpec, from: number | Date, tz?: string): number {
  const spec = typeof cron === "string" ? parseCron(cron) : cron;
  const start = typeof from === "number" ? from : from.getTime();
  let t = Math.floor(start / MINUTE) * MINUTE + MINUTE;
  const limit = start + 4 * 366 * 86_400_000;
  while (t <= limit) {
    const w = wallClock(t, tz);
    if (!dayMatches(spec, w)) {
      t += (1440 - (w.hour * 60 + w.minute)) * MINUTE;
      continue;
    }
    if (!spec.hour.has(w.hour)) {
      t += (60 - w.minute) * MINUTE;
      continue;
    }
    if (!spec.minute.has(w.minute)) {
      t += MINUTE;
      continue;
    }
    return t;
  }
  throw invalid(typeof cron === "string" ? cron : "spec", "never fires");
}

/** How many times `cron` fires in the window `[from, from + windowMs)`, capped at `cap` (frequency comparisons). */
export function countFires(cron: string, from: number, windowMs: number, tz?: string, cap = 10_000): number {
  const spec = parseCron(cron);
  let n = 0;
  let t = from - 1;
  while (n < cap) {
    try {
      t = nextScheduleFire(spec, t, tz);
    } catch {
      return n;
    }
    if (t >= from + windowMs) break;
    n++;
  }
  return n;
}

export interface QuietHours {
  /** IANA time zone, e.g. "Europe/Berlin". */
  tz: string;
  /** Local "HH:MM" start (inclusive). */
  start: string;
  /** Local "HH:MM" end (exclusive). A start later than the end spans midnight. */
  end: string;
}

function minutesOf(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** True when `at` falls inside the quiet window. */
export function inQuietHours(at: number, quiet: QuietHours | undefined): boolean {
  if (!quiet) return false;
  const w = wallClock(at, quiet.tz);
  const now = w.hour * 60 + w.minute;
  const s = minutesOf(quiet.start);
  const e = minutesOf(quiet.end);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** The first minute at or after `at` outside the quiet window (`at` itself when not quiet). */
export function quietHoursEnd(at: number, quiet: QuietHours | undefined): number {
  if (!inQuietHours(at, quiet)) return at;
  let t = Math.floor(at / MINUTE) * MINUTE + MINUTE;
  for (let i = 0; i < 1500 && inQuietHours(t, quiet); i++) t += MINUTE;
  return t;
}
