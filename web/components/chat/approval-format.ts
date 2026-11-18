/**
 * Turns an approval's raw tool arguments into rows a person can read:
 * `from_daily_usd: 40` → "From · $40 a day", `scheduled_at` → "Scheduled ·
 * Nov 18, 9:00 AM", `campaign_id` → the campaign's name when it's known.
 *
 * Pure: no React, no DOM, no clock. Dates take an explicit `timeZone` so the
 * output is the same on the server, in the browser and in a test.
 */

export interface ArgRow {
  label: string;
  value: string;
}

export interface FormatOptions {
  /** id → display name, from whatever the caller has on hand (tool results, playbooks, campaigns). */
  names?: Readonly<Record<string, string>>;
  /** IANA zone for dates. Omit to use the runtime's zone. */
  timeZone?: string;
  /** Most rows to return. */
  max?: number;
}

/** Plumbing a person never needs to approve. */
const HIDDEN = new Set(["type", "kind", "question_id", "questionid", "idempotency_key", "idempotencykey", "approval_id", "approvalid", "tenant_id", "tenantid", "user_id", "userid", "run_id", "runid", "args_hash", "trace_id", "request_id", "dry_run"]);

const MONEY_UNITS: Record<string, number> = { usd: 1, dollars: 1, dollar: 1, cents: 100, cent: 100, micros: 1_000_000 };
const PERIODS: Record<string, string> = { daily: "a day", day: "a day", weekly: "a week", week: "a week", monthly: "a month", month: "a month", hourly: "an hour" };
const PERCENT_UNITS = new Set(["pct", "percent", "percentage"]);
const FRACTION_WORDS = new Set(["rate", "ratio", "share", "probability", "confidence"]);
const DATE_UNITS = new Set(["at", "on", "date", "time", "until", "since", "after", "before"]);
const DURATIONS: Record<string, [string, string]> = { ms: ["millisecond", "milliseconds"], sec: ["second", "seconds"], secs: ["second", "seconds"], seconds: ["second", "seconds"], mins: ["minute", "minutes"], minutes: ["minute", "minutes"], hours: ["hour", "hours"], days: ["day", "days"], weeks: ["week", "weeks"] };
const ID_UNITS = new Set(["id", "ids", "uuid", "ref"]);
const ACRONYMS = new Set(["cpa", "cpc", "cpm", "ctr", "roas", "roi", "url", "seo", "utm", "id", "qa", "cta", "sms", "api", "tts", "ai"]);

/** Whole phrases that read better than their parts. Keyed by the label after unit words are removed. */
const LABELS: Record<string, string> = {
  "": "Value",
  niche: "Playbook",
  "dollar delta": "Change",
  delta: "Change",
  "requested by": "Requested by",
  "ad account": "Ad account",
  objective: "Goal",
  count: "How many",
  n: "How many",
  q: "Search",
  query: "Search",
  cta: "Call to action",
};

const VALUES: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok: "TikTok",
  tiktok_ads: "TikTok Ads",
  youtube: "YouTube",
  shorts: "YouTube Shorts",
  reels: "Instagram Reels",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENUM = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/;

/** "fromDailyUsd" / "from_daily_usd" / "from-daily-usd" → ["from", "daily", "usd"]. */
export function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

function sentence(words: string[]): string {
  const phrase = words.join(" ");
  const known = LABELS[phrase];
  if (known) return known;
  return words.map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/** "$40", "$12.50", "−$3.20", "$1,200". Whole dollars drop the cents. */
export function formatMoney(amount: number): string {
  const abs = Math.abs(amount);
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  const text = abs.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${amount < 0 ? "−" : ""}$${text}`;
}

/** "12%", "4.5%". */
export function formatPercent(value: number): string {
  const tenth = Math.round(value * 10) / 10;
  return `${Number.isInteger(tenth) ? tenth : tenth.toFixed(1)}%`;
}

/** "Nov 18, 2026" for a date, "Nov 18, 9:00 AM" for a date and time. Returns null when it isn't a date. */
export function formatWhen(iso: string, timeZone?: string): string | null {
  if (!ISO_DATE.test(iso)) return null;
  const dateOnly = iso.length === 10;
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  if (dateOnly) return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(?:\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function nameFor(id: string, names: FormatOptions["names"]): string {
  const known = names?.[id];
  if (known) return known;
  return UUID.test(id) ? `ID ${id.slice(0, 8)}` : id;
}

/** A value with no unit hint from its key. */
function plain(v: unknown, opts: FormatOptions, depth = 0): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";
  if (typeof v === "string") {
    const s = v.trim();
    const mapped = VALUES[s.toLowerCase()];
    if (mapped) return mapped;
    const when = formatWhen(s, opts.timeZone);
    if (when) return when;
    if (opts.names?.[s]) return opts.names[s]!;
    if (UUID.test(s)) return `ID ${s.slice(0, 8)}`;
    if (ENUM.test(s) && s.length <= 40) {
      const words = s.split(/[_-]/);
      return words.map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
    }
    return clip(s, 120);
  }
  if (Array.isArray(v)) {
    const parts = v.filter((x) => x !== null && x !== undefined && x !== "").map((x) => plain(x, opts, depth + 1));
    const shown = parts.slice(0, 4).join(", ");
    return clip(parts.length > 4 ? `${shown} and ${parts.length - 4} more` : shown, 120);
  }
  if (v && typeof v === "object") {
    if (depth >= 2) return "…";
    const rows = formatApprovalArgs(v, { ...opts, max: 4 }, depth + 1);
    return clip(rows.map((r) => `${r.label.toLowerCase()} ${r.value}`).join(", "), 120);
  }
  return "";
}

function formatEntry(key: string, raw: unknown, opts: FormatOptions, depth: number): ArgRow | null {
  const words = keyWords(key);
  if (words.length === 0) return null;
  const last = words[words.length - 1]!;
  const n = num(raw);
  const period = words.map((w) => PERIODS[w]).find(Boolean);

  // Money: "_usd", "_cents", "_micros", or a key that is plainly about money.
  const unit = words.find((w) => w in MONEY_UNITS);
  const moneyWord = words.some((w) => w === "budget" || w === "spend" || w === "cost" || w === "price" || w === "cap");
  if (n !== null && (unit || (moneyWord && !words.some((w) => PERCENT_UNITS.has(w))))) {
    const rest = words.filter((w) => !(w in MONEY_UNITS) && !(w in PERIODS));
    const label = rest.length === 0 ? "Amount" : sentence(rest);
    return { label, value: `${formatMoney(n / (unit ? MONEY_UNITS[unit]! : 1))}${period ? ` ${period}` : ""}` };
  }

  // Percentages: "_pct" / "_percent" are already in percent; rates and shares between 0 and 1 are fractions.
  if (n !== null && words.some((w) => PERCENT_UNITS.has(w))) return { label: sentence(words.filter((w) => !PERCENT_UNITS.has(w))), value: formatPercent(n) };
  if (n !== null && FRACTION_WORDS.has(last) && n >= 0 && n <= 1) return { label: sentence(words), value: formatPercent(n * 100) };

  // Durations: "_sec", "_ms", "_days".
  if (n !== null && last in DURATIONS && words.length > 1) {
    const [one, many] = DURATIONS[last]!;
    return { label: sentence(words.slice(0, -1)), value: `${n.toLocaleString("en-US")} ${n === 1 ? one : many}` };
  }

  // Dates: an ISO value. "scheduled_at" reads as "Scheduled".
  if (typeof raw === "string") {
    const when = formatWhen(raw.trim(), opts.timeZone);
    if (when) {
      const rest = DATE_UNITS.has(last) && words.length > 1 ? words.slice(0, -1) : words;
      return { label: sentence(rest), value: when };
    }
  }

  // Ids: show the name when we have it, a short id when we don't.
  if (ID_UNITS.has(last) && words.length > 1) {
    const rest = words.slice(0, -1);
    if (typeof raw === "string") return { label: sentence(rest), value: nameFor(raw.trim(), opts.names) };
    if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
      const shown = (raw as string[]).slice(0, 4).map((x) => nameFor(x, opts.names));
      return { label: sentence(rest), value: raw.length > 4 ? `${shown.join(", ")} and ${raw.length - 4} more` : shown.join(", ") };
    }
  }

  const value = plain(raw, opts, depth);
  return value ? { label: sentence(words), value } : null;
}

/**
 * The rows to show on an approval card. Skips empty values and plumbing, drops
 * an id when the same thing is already named (`campaign_id` next to
 * `campaign` or `campaign_name`), and caps the list.
 */
export function formatApprovalArgs(args: unknown, opts: FormatOptions = {}, depth = 0): ArgRow[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const entries = Object.entries(args as Record<string, unknown>).filter(([k, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0) && !HIDDEN.has(k.toLowerCase()));
  const present = new Set(entries.map(([k]) => keyWords(k).join(" ")));
  const out: ArgRow[] = [];
  for (const [key, raw] of entries) {
    const words = keyWords(key);
    const last = words[words.length - 1];
    if (last && ID_UNITS.has(last) && words.length > 1) {
      const stem = words.slice(0, -1).join(" ");
      const known = typeof raw === "string" && Boolean(opts.names?.[raw]);
      // The thing is already named by a sibling argument: the id adds nothing.
      if (!known && (present.has(stem) || present.has(`${stem} name`) || present.has(`${stem} title`))) continue;
    }
    // "campaign_name" beside "campaign": keep one.
    if ((last === "name" || last === "title") && words.length > 1 && present.has(words.slice(0, -1).join(" "))) continue;
    const row = formatEntry(key, raw, opts, depth);
    if (!row) continue;
    if ((last === "name" || last === "title") && words.length > 1) row.label = sentence(words.slice(0, -1));
    out.push(row);
    if (out.length >= (opts.max ?? 6)) break;
  }
  return out;
}

/**
 * Collect id → name pairs from anything shaped like a record with an `id` and
 * a `name`, `title` or `label` (tool results, usually), so ids in later
 * approvals can be shown as names. Bounded: it stops after `limit` names.
 */
export function collectNames(value: unknown, into: Record<string, string> = {}, limit = 500, depth = 0): Record<string, string> {
  if (!value || typeof value !== "object" || depth > 5 || Object.keys(into).length >= limit) return into;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 200)) collectNames(v, into, limit, depth + 1);
    return into;
  }
  const o = value as Record<string, unknown>;
  const id = typeof o.id === "string" || typeof o.id === "number" ? String(o.id) : null;
  const name = [o.name, o.title, o.label].find((x): x is string => typeof x === "string" && x.trim() !== "");
  if (id && name && !(id in into)) into[id] = clip(name.trim(), 80);
  for (const v of Object.values(o)) if (v && typeof v === "object") collectNames(v, into, limit, depth + 1);
  return into;
}
