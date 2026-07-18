// Client-safe typed client for the phase 2 Press-Analytics backends: GSC
// (/api/v1/gsc), keyword research (/api/v1/keywords), content intelligence
// (/api/v1/intelligence), competitors (/api/v1/competitors), and
// newsletters (/api/v1/newsletters). Mirrors lib/press-client.ts's
// key-builder / mutation / humanize-error conventions. All types here are
// hand-written mirrors of the pydantic models in the corresponding
// backend/routes/*.py + src/marketer/repos/*.py files, no server-only
// imports, this runs in the browser via SWR + the /api/proxy/... forwarder.

import { ApiError, clientFetch } from "@/lib/client-fetcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// --- GSC ---------------------------------------------------------------

export interface GscStatus {
  connected: boolean;
  site_url: string;
}

export interface GscConnectResponse {
  authorize_url: string;
  state: string;
}

export interface GscRankingItem {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  prior_position: number | null;
  position_delta: number | null;
}

export interface GscRankingsResponse {
  site_url: string;
  start: string;
  end: string;
  items: GscRankingItem[];
}

export interface GscGapItem {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface GscGapsResponse {
  items: GscGapItem[];
}

// --- Keywords ------------------------------------------------------------

export type KeywordStatus = "candidate" | "tracked" | "dismissed" | "promoted";

export interface KeywordCandidate {
  id: string;
  user_id: string;
  niche_id: string;
  keyword: string;
  intent: string;
  // Decimal on the wire -> pydantic v2 JSON-encodes Decimal as a string.
  difficulty: string | null;
  volume_hint: string;
  rationale: string;
  status: KeywordStatus;
  created_at: string;
}

// --- Content intelligence -------------------------------------------------

export interface ContentCluster {
  id: string;
  user_id: string;
  niche_id: string;
  title: string;
  pillar_keyword: string;
  description: string;
  created_at: string;
}

export type ClusterItemStatus = "proposed" | "covered";

export interface ContentClusterItem {
  id: string;
  cluster_id: string;
  article_id: string | null;
  proposed_title: string;
  focus_keyword: string;
  status: ClusterItemStatus;
}

export interface ClusterWithItems extends ContentCluster {
  items: ContentClusterItem[];
}

export interface TopicProposalLite {
  id: string;
  user_id: string;
  niche_id: string;
  title: string;
  focus_keyword: string;
  rationale: string;
  score: number;
  status: string;
  created_at: string;
}

export interface AuditRunSummary {
  audited: number;
  average_score: number;
  low_score_count: number;
}

export interface ArticleAudit {
  id: string;
  user_id: string;
  article_id: string;
  score: number;
  findings: Record<string, unknown>[];
  created_at: string;
}

export interface CannibalizationFinding {
  id: string;
  user_id: string;
  article_a: string;
  article_b: string;
  keyword: string;
  similarity: number;
  resolution: string;
  created_at: string;
}

// --- Competitors -----------------------------------------------------------

export interface Competitor {
  id: string;
  user_id: string;
  niche_id: string | null;
  domain: string;
  label: string;
  created_at: string;
}

export interface CompetitorArticle {
  id: string;
  competitor_id: string;
  url: string;
  title: string;
  published_hint: string;
  first_seen: string;
}

export type AlertKind =
  | "competitor_activity"
  | "ranking_drop"
  | "cadence_slip"
  | "quality_drop";
export type AlertSeverity = "info" | "warning" | "critical";

export interface PerformanceAlert {
  id: string;
  user_id: string;
  kind: string;
  severity: string;
  message: string;
  context: Record<string, unknown>;
  created_at: string;
  acknowledged_at: string | null;
}

export interface WatchRunResult {
  skipped?: string;
  competitors_scanned?: number;
  found?: number;
  alerts_raised?: number;
}

// --- Newsletters -----------------------------------------------------------

export type NewsletterCadence = "weekly" | "biweekly" | "monthly";

export interface NewsletterSettings {
  user_id: string;
  enabled: boolean;
  cadence: NewsletterCadence;
  send_to: string;
  last_sent_at: string | null;
}

export type DigestStatus = "draft" | "sent" | "failed";

export interface NewsletterDigest {
  id: string;
  user_id: string;
  subject: string;
  markdown: string;
  html: string;
  article_ids: string[];
  status: DigestStatus;
  error: string;
  created_at: string | null;
  sent_at: string | null;
}

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

const GSC = "/api/v1/gsc";
const KEYWORDS = "/api/v1/keywords";
const INTEL = "/api/v1/intelligence";
const COMPETITORS = "/api/v1/competitors";
const NEWSLETTERS = "/api/v1/newsletters";

export const analyticsKeys = {
  gscStatus: () => `${GSC}/status`,
  gscConnect: (returnTo?: string) =>
    `${GSC}/connect${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ""}`,
  gscRankings: (days: number) => `${GSC}/rankings?days=${days}`,
  gscGaps: (days: number) => `${GSC}/gaps?days=${days}`,

  keywords: (opts?: { niche_id?: string; status?: KeywordStatus }) => {
    const params = new URLSearchParams();
    if (opts?.niche_id) params.set("niche_id", opts.niche_id);
    if (opts?.status) params.set("status", opts.status);
    params.set("limit", "200");
    return `${KEYWORDS}?${params.toString()}`;
  },

  clusters: () => `${INTEL}/clusters`,
  cluster: (id: string) => `${INTEL}/clusters/${encodeURIComponent(id)}`,

  audits: () => `${INTEL}/audit`,
  cannibalization: () => `${INTEL}/cannibalization`,

  competitors: () => COMPETITORS,
  competitorArticles: (id: string) => `${COMPETITORS}/${encodeURIComponent(id)}/articles`,
  alerts: (acknowledged?: boolean) =>
    acknowledged === undefined
      ? `${COMPETITORS}/alerts`
      : `${COMPETITORS}/alerts?acknowledged=${acknowledged}`,

  newsletterSettings: () => `${NEWSLETTERS}/settings`,
  newsletterDigests: () => NEWSLETTERS,
  newsletterDigest: (id: string) => `${NEWSLETTERS}/${encodeURIComponent(id)}`,
};

// ---------------------------------------------------------------------------
// Fetchers (reads, via SWR + /api/proxy)
// ---------------------------------------------------------------------------

export const gscStatusFetcher = clientFetch<GscStatus>;
export const gscConnectFetcher = clientFetch<GscConnectResponse>;
export const gscRankingsFetcher = clientFetch<GscRankingsResponse>;
export const gscGapsFetcher = clientFetch<GscGapsResponse>;

export const keywordsFetcher = clientFetch<KeywordCandidate[]>;

export const clustersFetcher = clientFetch<ContentCluster[]>;
export const clusterFetcher = clientFetch<ClusterWithItems>;

export const auditsFetcher = clientFetch<ArticleAudit[]>;
export const cannibalizationFetcher = clientFetch<CannibalizationFinding[]>;

export const competitorsFetcher = clientFetch<Competitor[]>;
export const competitorArticlesFetcher = clientFetch<CompetitorArticle[]>;
export const alertsFetcher = clientFetch<PerformanceAlert[]>;

export const newsletterSettingsFetcher = clientFetch<NewsletterSettings>;
export const newsletterDigestsFetcher = clientFetch<NewsletterDigest[]>;
export const newsletterDigestFetcher = clientFetch<NewsletterDigest>;

// ---------------------------------------------------------------------------
// Mutations (writes, via /api/proxy so the Clerk JWT is attached server-side)
// ---------------------------------------------------------------------------

async function proxyMutate<T>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
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
  if (ct.includes("application/json")) return (await res.json()) as T;
  return undefined as T;
}

// --- GSC ---------------------------------------------------------------

/** 409 (GscDisabled) when Google OAuth keys aren't configured. */
export function setGscSite(site_url: string): Promise<GscStatus> {
  return proxyMutate<GscStatus>(`${GSC}/site`, "POST", { site_url });
}

export function deleteGscConnection(): Promise<GscStatus> {
  return proxyMutate<GscStatus>(`${GSC}/connection`, "DELETE");
}

// --- Keywords --------------------------------------------------------------

/** One metered LLM call. 402 when the channel's daily cap is spent. */
export function harvestKeywords(
  niche_id: string,
  n?: number,
): Promise<KeywordCandidate[]> {
  return proxyMutate<KeywordCandidate[]>(`${KEYWORDS}/harvest`, "POST", {
    niche_id,
    ...(n ? { n } : {}),
  });
}

export function trackKeyword(id: string): Promise<KeywordCandidate> {
  return proxyMutate<KeywordCandidate>(`${KEYWORDS}/${encodeURIComponent(id)}/track`, "POST");
}

export function dismissKeyword(id: string): Promise<KeywordCandidate> {
  return proxyMutate<KeywordCandidate>(`${KEYWORDS}/${encodeURIComponent(id)}/dismiss`, "POST");
}

export function scoreKeyword(id: string): Promise<KeywordCandidate> {
  return proxyMutate<KeywordCandidate>(`${KEYWORDS}/${encodeURIComponent(id)}/score`, "POST");
}

export function promoteKeyword(id: string): Promise<KeywordCandidate> {
  return proxyMutate<KeywordCandidate>(`${KEYWORDS}/${encodeURIComponent(id)}/promote`, "POST");
}

// --- Clusters ----------------------------------------------------------

/** One metered LLM call. 402 when the channel's daily cap is spent. */
export function planCluster(
  niche_id: string,
  pillar_keyword: string,
): Promise<ClusterWithItems> {
  return proxyMutate<ClusterWithItems>(`${INTEL}/clusters/plan`, "POST", {
    niche_id,
    pillar_keyword,
  });
}

export function deleteCluster(id: string): Promise<void> {
  return proxyMutate<void>(`${INTEL}/clusters/${encodeURIComponent(id)}`, "DELETE");
}

/** 409 when the spoke is already covered. */
export function promoteClusterItem(
  clusterId: string,
  itemId: string,
): Promise<TopicProposalLite> {
  return proxyMutate<TopicProposalLite>(
    `${INTEL}/clusters/${encodeURIComponent(clusterId)}/items/${encodeURIComponent(itemId)}/promote`,
    "POST",
  );
}

// --- Audit / cannibalization ---------------------------------------------

export function runAudit(): Promise<AuditRunSummary> {
  return proxyMutate<AuditRunSummary>(`${INTEL}/audit/run`, "POST");
}

export function scanCannibalization(): Promise<CannibalizationFinding[]> {
  return proxyMutate<CannibalizationFinding[]>(`${INTEL}/cannibalization/scan`, "POST");
}

// --- Competitors ---------------------------------------------------------

export interface CreateCompetitorInput {
  domain: string;
  label?: string;
  niche_id?: string;
}

/** 409 when the domain is already tracked. */
export function createCompetitor(input: CreateCompetitorInput): Promise<Competitor> {
  return proxyMutate<Competitor>(COMPETITORS, "POST", input);
}

export function deleteCompetitor(id: string): Promise<void> {
  return proxyMutate<void>(`${COMPETITORS}/${encodeURIComponent(id)}`, "DELETE");
}

export function runCompetitorWatch(): Promise<WatchRunResult> {
  return proxyMutate<WatchRunResult>(`${COMPETITORS}/watch/run`, "POST");
}

export function ackAlert(id: string): Promise<PerformanceAlert> {
  return proxyMutate<PerformanceAlert>(
    `${COMPETITORS}/alerts/${encodeURIComponent(id)}/ack`,
    "POST",
  );
}

// --- Newsletters -----------------------------------------------------------

export interface PutNewsletterSettingsInput {
  enabled: boolean;
  cadence: NewsletterCadence;
  send_to?: string;
}

export function putNewsletterSettings(
  input: PutNewsletterSettingsInput,
): Promise<NewsletterSettings> {
  return proxyMutate<NewsletterSettings>(`${NEWSLETTERS}/settings`, "PUT", input);
}

/** 409 when there's nothing new to compose; 402 on the metered LLM cap. */
export function composeDigest(): Promise<NewsletterDigest> {
  return proxyMutate<NewsletterDigest>(`${NEWSLETTERS}/compose`, "POST");
}

/** 409 when the digest was already sent. */
export function sendDigest(id: string): Promise<NewsletterDigest> {
  return proxyMutate<NewsletterDigest>(`${NEWSLETTERS}/${encodeURIComponent(id)}/send`, "POST");
}

// ---------------------------------------------------------------------------
// Error humanizing
// ---------------------------------------------------------------------------

/** Turn an ApiError (or any thrown value) into copy a user can read.
 *  Mirrors humanizePressError's convention (same noun: "channel"). */
export function humanizeAnalyticsError(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.message.replace(/^\d+\s*/, "");
    if (e.status === 402) {
      return "Daily spend cap reached for this channel. Wait for it to reset or raise the cap in the channel's settings.";
    }
    if (e.status === 502) {
      return "That didn't go through on the provider's end. Try again in a moment.";
    }
    if (e.status === 409 || e.status === 503) {
      return extractDetail(body) ?? "That can't be done right now.";
    }
    if (e.status === 403) {
      return extractDetail(body) ?? "You don't have access to that in Google Search Console.";
    }
    if (e.status === 429) {
      return "Too many requests right now. Give it a moment, then try again.";
    }
    if (e.status >= 500) {
      return "Something went wrong on our end. Try again in a moment.";
    }
    return extractDetail(body) ?? body ?? `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

/** True when the error is Search Console being unconfigured (no Google
 *  OAuth client id/secret set on the backend), vs. any other failure. */
export function isGscNotConfigured(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.status !== 409 && e.status !== 503) return false;
  return /not configured/i.test(e.message);
}

function extractDetail(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { detail?: string | Array<{ msg?: string }> };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) {
      return parsed.detail[0].msg ?? null;
    }
  } catch {
    // Not JSON, fall through.
  }
  return null;
}
