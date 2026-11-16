// Typed access to the workspace aggregate endpoints (/api/v1/workspace/*),
// which join every department into one inbox, one activity feed and one
// analytics view. Mirrors backend/routes/workspace.py. Client-safe: server
// fetches live in ./workspace-server.

export interface Kpis {
  total_spend_usd: string;
  content_spend_usd: string;
  ad_spend_usd: string;
  posts_published: number;
  articles_published: number;
  views: number;
  engagements: number;
  ad_clicks: number;
  ad_conversions: number;
}

export interface SeriesRow {
  day: string;
  content_spend_usd: string;
  ad_spend_usd: string;
  views: number;
  posts: number;
}

export interface Overview {
  days: number;
  kpis: Kpis;
  previous_kpis: Kpis;
  series: SeriesRow[];
  pipeline: {
    content: { active: number; done: number; failed: number };
    seo: { active: number; done: number; failed: number };
    ads: { active_campaigns: number; pending_approvals: number };
  };
  top_content: { kind: "video" | "article" | "carousel"; id: string; title: string; platform: string | null; views: number | null; created_at: string }[];
}

export type InboxKind = "video" | "carousel" | "ad_change";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  ref_id: string;
  title: string;
  detail: string;
  niche_id: string | null;
  created_at: string;
}

export interface Inbox {
  items: InboxItem[];
  counts: { total: number; video: number; carousel: number; ad_change: number };
}

export type ActivityKind = "video" | "article" | "carousel" | "ad_action" | "approval" | "campaign";

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  status: string;
  title: string;
  detail: string;
  ref_id: string;
}

export interface Activity {
  events: ActivityEvent[];
  next_before: string | null;
}

export const EMPTY_INBOX: Inbox = { items: [], counts: { total: 0, video: 0, carousel: 0, ad_change: 0 } };

/** Where an inbox item or activity event opens. */
export function hrefFor(kind: string, refId: string): string {
  switch (kind) {
    case "video":
      return `/content/videos/${refId}`;
    case "carousel":
      return `/content?tab=carousels`;
    case "article":
      return `/seo/${refId}`;
    case "ad_change":
    case "ad_action":
    case "approval":
      return `/paid`;
    case "campaign":
      return `/distribution/campaigns/${refId}`;
    default:
      return "/activity";
  }
}
