import { api } from "@/lib/api";
import { calendarKey, DEFAULT_CALENDAR_RANGE } from "@/components/calendar/types";
import type { CalendarItem } from "@/components/calendar/types";
import type { Niche } from "@/lib/types";
import { CalendarClient } from "./CalendarClient";

export const dynamic = "force-dynamic";

export default async function Calendar() {
  // Fetch the default window (next 30 days) server-side so the agenda
  // paints immediately; the client hands this to SWR as fallbackData
  // under the matching key.
  const [items, niches] = await Promise.all([
    api<CalendarItem[]>(calendarKey(DEFAULT_CALENDAR_RANGE)),
    api<Niche[]>("/api/v1/niches"),
  ]);
  // Real niche_id -> title lookup for the table's "Niche" column —
  // calendar items only carry niche_id, so we resolve titles once
  // server-side (same technique as queue/page.tsx).
  const nicheTitles = Object.fromEntries(niches.map((n) => [n.id, n.title]));

  return <CalendarClient initial={items} nicheTitles={nicheTitles} />;
}
