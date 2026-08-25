// Client-safe typed client for the scheduled-posts calendar
// (/api/v1/scheduled-posts).
//
// Reads use SWR keys that are plain backend paths - `clientFetch` prefixes
// /api/proxy for us. Mutations go through the same /api/proxy/... handler so
// the Clerk JWT is attached server-side. NOTHING here may import server-only
// modules - this file runs in the browser.
//
// Shapes mirror `src/marketer/scheduling/schemas.py` field for field.

import { ApiError, clientFetch } from "@/lib/client-fetcher";

// --- Vocabulary --------------------------------------------------------

/** Ayrshare's platform vocabulary, exactly as `SUPPORTED_PLATFORMS`. */
export const PLATFORMS = [
  "bluesky",
  "facebook",
  "instagram",
  "linkedin",
  "pinterest",
  "reddit",
  "telegram",
  "threads",
  "tiktok",
  "twitter",
  "youtube",
] as const;

export type PlatformName = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<string, string> = {
  bluesky: "Bluesky",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  reddit: "Reddit",
  telegram: "Telegram",
  threads: "Threads",
  tiktok: "TikTok",
  twitter: "X / Twitter",
  youtube: "YouTube",
};

export function platformLabel(name: string): string {
  return PLATFORM_LABELS[name] ?? name;
}

/** Parent lifecycle. `due` is a *filter*, never a stored value. */
export type PostStatus =
  | "scheduled"
  | "dispatching"
  | "posted"
  | "partial"
  | "failed";

/** Per-platform delivery state - one post can partially succeed. */
export type VariantStatus = "pending" | "dispatching" | "posted" | "failed";

export const MAX_CONTENT_CHARS = 5_000;
export const MAX_MEDIA_PER_POST = 10;

/** Statuses a post may still be edited or deleted from. Anything else is a
 *  409 from the backend: `dispatching` may be mid-flight to a real account,
 *  and `posted` has live posts we cannot recall. */
export const MUTABLE_POST_STATUSES: ReadonlySet<string> = new Set([
  "scheduled",
  "failed",
  "partial",
]);

/** Only an undispatched post can be deleted (backend `delete` guard). */
export function canDelete(post: ScheduledPost): boolean {
  return post.status === "scheduled" || post.status === "failed";
}

/** publish-now claims `scheduled -> dispatching` atomically; anything else
 *  loses the race and 409s. */
export function canPublishNow(post: ScheduledPost): boolean {
  return post.status === "scheduled";
}

// --- Wire types --------------------------------------------------------

/**
 * One platform's copy of one scheduled post, with its OWN delivery status.
 * `content`/`media_urls` are null when the platform inherits the parent -
 * distinct from `""`, which means "this platform posts empty copy".
 */
export interface PlatformVariant {
  id: string | null;
  platform: string;
  content: string | null;
  media_urls: string[] | null;
  status: VariantStatus;
  provider_post_id: string | null;
  error: string | null;
  dispatched_at: string | null;
}

export interface ScheduledPost {
  id: string;
  user_id: string;
  content: string;
  media_urls: string[];
  /** ALWAYS UTC on the wire. */
  scheduled_at: string;
  /** The IANA zone the post was authored in. */
  timezone: string;
  status: PostStatus;
  /** manual | import | recurring */
  source: string;
  recurring_slot_id: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
  variants: PlatformVariant[];
}

/** Per-platform override on create/update. Omit a key to inherit. */
export interface VariantOverride {
  content?: string | null;
  media_urls?: string[] | null;
}

export interface ScheduledPostCreate {
  content: string;
  media_urls: string[];
  platforms: string[];
  /** ISO-8601 instant. */
  scheduled_at: string;
  timezone: string;
  variants: Record<string, VariantOverride>;
}

export interface ScheduledPostUpdate {
  content?: string;
  media_urls?: string[];
  scheduled_at?: string;
  timezone?: string;
  platforms?: string[];
  variants?: Record<string, VariantOverride>;
}

/** A weekly template. `weekday` is 0=Monday .. 6=Sunday. Stores local
 *  wall-clock time, never an offset, so it survives DST. */
export interface RecurringSlotCreate {
  label: string;
  weekday: number;
  hour: number;
  minute: number;
  timezone: string;
  platforms: string[];
  active: boolean;
}

export interface RecurringSlot extends RecurringSlotCreate {
  id: string;
  user_id: string;
  created_at: string | null;
  updated_at: string | null;
}

/** The CSV import report. Note the backend returns **200 even when every row
 *  failed** - this report IS the response, not an error envelope. Import is
 *  all-or-nothing: `created > 0` and a non-empty `errors` list only coexist
 *  when the datastore faulted mid-file. */
export interface ImportReport {
  created: number;
  errors: { row: number; message: string }[];
}

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// --- Read (SWR) --------------------------------------------------------

const POSTS = "/api/v1/scheduled-posts";

export const scheduledKeys = {
  list: (params: { status?: string; from?: string; to?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    qs.set("limit", String(params.limit ?? 100));
    return `${POSTS}?${qs.toString()}`;
  },
  detail: (id: string) => `${POSTS}/${encodeURIComponent(id)}`,
  recurring: () => `${POSTS}/recurring`,
};

export const scheduledPostsFetcher = clientFetch<ScheduledPost[]>;
export const recurringSlotsFetcher = clientFetch<RecurringSlot[]>;

// --- Writes (proxy) ----------------------------------------------------

async function proxyMutate<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || `${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? ((await res.json()) as T) : (undefined as T);
}

export function createScheduledPost(body: ScheduledPostCreate): Promise<ScheduledPost> {
  return proxyMutate<ScheduledPost>(POSTS, "POST", body);
}

/** Partial update. Sending only `scheduled_at` is the drag-to-reschedule
 *  path. 409 when the post is dispatching or already posted. */
export function updateScheduledPost(
  id: string,
  patch: ScheduledPostUpdate,
): Promise<ScheduledPost> {
  return proxyMutate<ScheduledPost>(`${POSTS}/${encodeURIComponent(id)}`, "PATCH", patch);
}

export function deleteScheduledPost(id: string): Promise<void> {
  return proxyMutate<void>(`${POSTS}/${encodeURIComponent(id)}`, "DELETE");
}

/** 202 + `{status: "dispatching"}`. The claim is atomic server-side, so a
 *  double-click loses the race with a 409 rather than double-posting. */
export function publishNow(id: string): Promise<{ status: string; post_id: string }> {
  return proxyMutate(`${POSTS}/${encodeURIComponent(id)}/publish-now`, "POST");
}

export function listRecurringSlots(): Promise<RecurringSlot[]> {
  return clientFetch<RecurringSlot[]>(`${POSTS}/recurring`);
}

export function createRecurringSlot(body: RecurringSlotCreate): Promise<RecurringSlot> {
  return proxyMutate<RecurringSlot>(`${POSTS}/recurring`, "POST", body);
}

export function deleteRecurringSlot(id: string): Promise<void> {
  return proxyMutate<void>(`${POSTS}/recurring/${encodeURIComponent(id)}`, "DELETE");
}

/**
 * Upload a CSV. Resolves with the per-row report on 200 - including the
 * all-failed case, which is NOT an exception. Only a malformed upload
 * (400) or a transport failure rejects.
 *
 * Content-Type is left to the browser so the multipart boundary is set
 * correctly; the proxy forwards it verbatim.
 */
export async function importScheduledPosts(file: File): Promise<ImportReport> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`/api/proxy${POSTS}/import`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || `${res.status}`);
  }
  return (await res.json()) as ImportReport;
}

/** The header row + one example row, so the CSV format is discoverable
 *  without leaving the page. */
export const CSV_TEMPLATE_HEADER =
  "content,media_urls,platforms,scheduled_at,timezone,variant_linkedin";

// --- Errors ------------------------------------------------------------

/** Unwrap FastAPI's `{"detail": "..."}` envelope from the raw proxy text. */
export function scheduledErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.message.replace(/^\d+\s*/, "");
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
      if (Array.isArray(parsed.detail)) {
        const first = parsed.detail[0] as { msg?: string } | undefined;
        if (first?.msg) return first.msg;
      }
    } catch {
      /* not JSON - fall through */
    }
    return body || `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

export function isConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

// --- Timezone helpers (no date library - Intl only) --------------------

/** The browser's IANA zone, or UTC when it cannot be resolved. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A short curated zone list. The detected browser zone is folded in by
 *  `timezoneOptions()` so the common case is always one click. */
const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Athens",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function timezoneOptions(extra?: string): string[] {
  const set = new Set(COMMON_TIMEZONES);
  set.add(browserTimezone());
  if (extra) set.add(extra);
  return [...set].sort();
}

const PART_KEYS = ["year", "month", "day", "hour", "minute", "second"] as const;

function zoneParts(date: Date, tz: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const part of dtf.formatToParts(date)) {
    if ((PART_KEYS as readonly string[]).includes(part.type)) {
      out[part.type] = Number(part.value);
    }
  }
  return out;
}

/** Milliseconds a zone is ahead of UTC at a given instant. */
function zoneOffsetMs(date: Date, tz: string): number {
  const p = zoneParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Turn a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm") read as
 * wall-clock time *in `tz`* into the UTC instant the API stores.
 *
 * Two passes: the first guess uses the offset at the wrong instant, the
 * second corrects it. That converges everywhere except inside a DST spring
 * gap, where the result lands on the hour the zone actually has - which is
 * the same thing every date library does.
 */
export function wallClockToUtcIso(wall: string, tz: string): string {
  const [datePart, timePart = "00:00"] = wall.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const guess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  let ts = guess - zoneOffsetMs(new Date(guess), tz);
  ts = guess - zoneOffsetMs(new Date(ts), tz);
  return new Date(ts).toISOString();
}

/** The inverse: render a UTC instant as a `datetime-local` value in `tz`. */
export function utcIsoToWallClock(iso: string, tz: string): string {
  const p = zoneParts(new Date(iso), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Mon 9 Mar 2026, 09:00" in the post's own authoring zone. */
export function formatInZone(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Day bucket key ("2026-03-09") in the post's own zone, for grouping. */
export function dayKeyInZone(iso: string, tz: string): string {
  return utcIsoToWallClock(iso, tz).slice(0, 10);
}
