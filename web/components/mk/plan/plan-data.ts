// Plan data contract: one row per thing scheduled to go out, normalised from
// /api/v1/calendar (videos, articles, ad campaigns), /api/v1/image-posts
// (carousels) and /api/v1/campaigns (campaign starts). Pure + client-safe.

import { hrefFor } from "@/lib/workspace";

export type PlanKind = "video" | "carousel" | "article" | "ad" | "campaign";
export type PlanMode = "week" | "month";

export interface PlanItem {
  kind: PlanKind;
  id: string;
  title: string;
  status: string;
  platform: string | null;
  /** Playbook title, resolved server-side. */
  playbook: string | null;
  /** ISO instant it goes out. */
  at: string;
}

/** The raw /api/v1/calendar row (backend marketer.repos.calendar.CalendarItem). */
export interface CalendarRow {
  kind: "video" | "article" | "ad";
  id: string;
  niche_id: string;
  title: string;
  status: string;
  platform: string | null;
  at: string;
}

export const KIND_LABEL: Record<PlanKind, string> = { video: "Video", carousel: "Carousel", article: "Article", ad: "Ad campaign", campaign: "Campaign" };

const PLATFORM: Record<string, string> = { tiktok: "TikTok", reels: "Reels", shorts: "Shorts", meta_ads: "Meta", google_ads: "Google", meta: "Meta", google: "Google", instagram: "Instagram", youtube: "YouTube" };
export const platformLabel = (p: string | null) => (p ? (PLATFORM[p] ?? p.replace(/_/g, " ")) : null);

export function planHref(item: PlanItem): string {
  return hrefFor(item.kind === "ad" ? "ad_change" : item.kind, item.id);
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const at = (key: string) => new Date(`${key}T00:00:00Z`);

/**
 * The window a view shows (UTC calendar days, Monday-first).
 * week: the Monday-to-Sunday week `offset` weeks from today's.
 * month: the 5 or 6 whole weeks covering the month `offset` months away.
 */
export function planWindow(mode: PlanMode, offset: number, today: string): { start: string; days: number; anchor: string } {
  const t = at(today);
  if (mode === "week") {
    const monday = new Date(t);
    monday.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + offset * 7);
    const k = keyOf(monday);
    return { start: k, days: 7, anchor: k };
  }
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  return { start: keyOf(gridStart), days: weeks * 7, anchor: keyOf(first) };
}

export function parseMode(v: string | undefined): PlanMode {
  return v === "month" ? "month" : "week";
}

export function parseOffset(v: string | undefined): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(-24, Math.min(24, n)) : 0;
}
