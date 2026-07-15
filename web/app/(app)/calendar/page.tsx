import { api } from "@/lib/api";
import { calendarKey, DEFAULT_CALENDAR_RANGE } from "@/components/calendar/types";
import type { CalendarItem } from "@/components/calendar/types";
import { CalendarClient } from "./CalendarClient";

export const dynamic = "force-dynamic";

export default async function Calendar() {
  // Fetch the default window (next 30 days) server-side so the agenda
  // paints immediately; the client hands this to SWR as fallbackData
  // under the matching key.
  const items = await api<CalendarItem[]>(calendarKey(DEFAULT_CALENDAR_RANGE));
  return <CalendarClient initial={items} />;
}
