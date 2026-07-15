// Wire model for the /api/v1/calendar endpoint. Mirrors the backend
// CalendarItem shape: a unified row for either a scheduled video (job)
// or a scheduled article. `status` is the raw pipeline status string
// (JobStatus for videos, ArticleStatus for articles) which we humanize
// via the shared status-badge helpers.
export interface CalendarItem {
  kind: "video" | "article" | "ad";
  id: string;
  niche_id: string;
  title: string;
  status: string;
  platform: string | null;
  /** ISO datetime the item is scheduled to post. */
  at: string;
}

/** Selectable look-ahead windows (in days) for the agenda. */
export type CalendarRange = 7 | 30 | 90;

export const CALENDAR_RANGES: CalendarRange[] = [7, 30, 90];

export const DEFAULT_CALENDAR_RANGE: CalendarRange = 30;

/** SWR key + proxy path for a given look-ahead window. */
export function calendarKey(range: CalendarRange | number): string {
  return `/api/v1/calendar?days=${range}`;
}
