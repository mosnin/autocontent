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

export type RequiredActionResolution = "confirmed_succeeded" | "confirmed_failed";

/**
 * Something only a person can settle (docs/rails/required-actions.md). Today
 * one kind: a publish or spend whose outcome is unknown. Not an `InboxItem`:
 * `InboxKind` stays a closed union.
 */
export interface RequiredAction {
  id: string;
  kind: "indeterminate_outcome";
  action: string;
  title: string;
  detail: string;
  target_type: string;
  target_id: string;
  principal: string;
  created_at: string;
  resolve_path: string;
  resolutions: string[];
}

export interface Inbox {
  items: InboxItem[];
  /** `total` counts `items` only; required actions are counted separately. */
  counts: { total: number; video: number; carousel: number; ad_change: number; required_action?: number };
  /** Optional so payloads from before the rails still type-check. */
  required_actions?: RequiredAction[];
}

export const requiredActions = (inbox: Inbox | null | undefined): RequiredAction[] => inbox?.required_actions ?? [];

/** Everything waiting on a person: approvals plus required actions. */
export const waitingCount = (inbox: Inbox | null | undefined): number => (inbox ? inbox.counts.total + requiredActions(inbox).length : 0);

/** The id a required action is focused by (`/inbox?focus=…`), next to the `kind:ref` ids of inbox items. */
export const requiredActionFocusId = (id: string) => `required_action:${id}`;

/**
 * The inbox as the shell reads it. The sidebar's "Awaiting action" box and
 * the Activity count read only `items[].id`, `items[].title` and
 * `counts.total`, so required actions are folded in first (they block new
 * dispatches) and counted. For the shell only: pages keep the real payload.
 */
export function shellInbox(inbox: Inbox | null): Inbox | null {
  const required = requiredActions(inbox);
  if (!inbox || required.length === 0) return inbox;
  const folded = required.map((r) => ({ id: requiredActionFocusId(r.id), kind: "required_action", ref_id: r.id, title: r.title, detail: r.detail, niche_id: null, created_at: r.created_at }));
  return { ...inbox, items: [...(folded as unknown as InboxItem[]), ...inbox.items], counts: { ...inbox.counts, total: inbox.counts.total + required.length } };
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

export const EMPTY_INBOX: Inbox = { items: [], counts: { total: 0, video: 0, carousel: 0, ad_change: 0, required_action: 0 }, required_actions: [] };

/** One row of the caller's decision log (backend/routes/decisions.py). The state is never returned, only what was judged. */
export interface DecisionEntry {
  id: string;
  point: string;
  mode: "off" | "shadow" | "enforce" | (string & {});
  model: string | null;
  questions_version: string;
  answers: Record<string, unknown> | null;
  fallback_used: boolean;
  reason: string | null;
  latency_ms: number;
  cost_usd: string | null;
  action_taken: string;
  rule_action: string | null;
  table_action: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  outcome: Record<string, unknown> | null;
  correction: Record<string, unknown> | null;
  outcome_at: string | null;
  created_at: string;
}

export interface DecisionPage {
  items: DecisionEntry[];
  next_cursor: string | null;
}

async function post(path: string, body: unknown, conflict: string): Promise<void> {
  const res = await fetch(`/api/proxy${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  if (res.ok) return;
  if (res.status === 409) throw new Error(conflict);
  const text = await res.text().catch(() => "");
  let msg = text;
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === "string") msg = j.detail;
  } catch {
    /* not JSON */
  }
  throw new Error(msg.slice(0, 160) || `Failed (${res.status})`);
}

/** Approve or reject one inbox item (videos, carousels, ad changes) through the workspace decide endpoint. */
export function decideInboxItem(item: Pick<InboxItem, "kind" | "ref_id">, decision: "approve" | "reject"): Promise<void> {
  return post(`/api/v1/workspace/inbox/${item.kind}/${encodeURIComponent(item.ref_id)}/decide`, { decision }, "Already decided.");
}

/** A person records what happened to an unknown outcome. 404 means someone already resolved it. */
export async function resolveRequiredAction(id: string, resolution: RequiredActionResolution): Promise<void> {
  try {
    await post(`/api/v1/workspace/required-actions/${encodeURIComponent(id)}/resolve`, { resolution }, "Already resolved.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    throw new Error(/not found|already resolved/i.test(msg) ? "Already resolved, or no longer yours to resolve." : msg);
  }
}

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


const TARGET: Record<string, { label: string; href: (id: string) => string }> = {
  video_post: { label: "Video post", href: () => "/content" },
  job: { label: "Video", href: (id) => `/content/videos/${id}` },
  video: { label: "Video", href: (id) => `/content/videos/${id}` },
  image_post: { label: "Carousel", href: () => "/content?tab=carousels" },
  carousel: { label: "Carousel", href: () => "/content?tab=carousels" },
  ad_campaign: { label: "Ad campaign", href: (id) => `/paid/campaigns/${id}` },
  ad_account: { label: "Ad account", href: () => "/paid/connect" },
  ad_approval: { label: "Ad change", href: () => "/paid" },
  campaign: { label: "Campaign", href: (id) => `/distribution/campaigns/${id}` },
};

/** What a required action was attempted on, in words, and where to look at it. Unknown targets fall back to their type. */
export function requiredActionTarget(r: Pick<RequiredAction, "target_type" | "target_id">): { label: string; href: string | null } {
  const t = TARGET[r.target_type];
  if (t) return { label: t.label, href: r.target_id ? t.href(encodeURIComponent(r.target_id)) : null };
  const words = r.target_type.replace(/[_.]/g, " ").trim();
  return { label: words ? words.replace(/^\w/, (c) => c.toUpperCase()) : "The platform", href: null };
}
