// Client-safe wire types for the business pages (distribution, integrations)
// that have no typed client of their own yet. Mirrors the backend models.

/** GET /api/v1/calendar (marketer.repos.calendar.CalendarItem). */
export interface CalendarItem {
  kind: string; // video | article | ad
  id: string;
  niche_id: string;
  title: string;
  status: string;
  platform: string | null;
  /** scheduled_for for videos, created_at for articles/ads. */
  at: string;
}

/** GET /api/v1/x402/config: whether agents can fund credit over HTTP 402. */
export interface X402Config {
  enabled: boolean;
  network: string | null;
  asset: string | null;
  pay_to: string | null;
  min_usd: string | number;
  max_usd: string | number;
}

/** A playbook reference for pickers (a Niche's id + title is all we need). */
export interface PlaybookRef {
  id: string;
  title: string;
}
