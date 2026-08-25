// Client-safe typed client for the AI SEO auditor (/api/v1/seo-audits).
//
// Reads use SWR keys that are plain backend paths - `clientFetch` prefixes
// /api/proxy for us. Mutations go through the same /api/proxy/... handler so
// the Clerk JWT is attached server-side (we cannot call `auth()` in the
// browser). NOTHING here may import server-only modules.
//
// The shapes below mirror `src/marketer/seoaudit/types.py` field for field
// (snake_case on the wire) plus the two response models in
// `backend/routes/seo_audits.py`.

import { ApiError, clientFetch } from "@/lib/client-fetcher";

// --- Wire types --------------------------------------------------------

/**
 * Outcome of a single rule.
 *
 * `na` is NOT a failure: the rule did not apply to this page, so it earns no
 * credit *and* is removed from its category's denominator entirely. Rendering
 * it as a failure misreads the whole scoring model.
 */
export type AuditStatus = "pass" | "partial" | "fail" | "na";

export interface AuditItem {
  id: string;
  label: string;
  status: AuditStatus;
  evidence: string;
  recommendation: string;
  /** Points earned. Always 0 for an `na` item. */
  score: number;
  /** This rule's share of its category. Always 0 for an `na` item. */
  max_score: number;
}

export interface AuditCategory {
  id: string;
  name: string;
  description: string;
  score: number;
  max_score: number;
  /** How many rules were dropped because they did not apply to this page. */
  na_excluded: number;
  items: AuditItem[];
}

export interface AuditBand {
  /** "Critical" | "Below average" | "Average" | "Strong" | "Excellent". */
  label: string;
  interpretation: string;
}

export interface AgentIssuePrompt {
  id: string;
  label: string;
  prompt: string;
}

export interface AgentFixPrompts {
  full: string;
  top_issues: AgentIssuePrompt[];
}

export interface AuditStats {
  markdown_chars: number;
  raw_html_chars: number;
  words: number;
  headings: number;
  links: number;
  external_links: number;
  json_ld_blocks: number;
}

/** How the two Context.dev scrapes went - so a low score can be read as
 *  "the page is weak" rather than "the scrape came back empty". */
export interface AuditDiagnostics {
  /** "ready" | "empty" | "failed" */
  context_dev_markdown: string;
  /** "ready" | "empty" | "failed" */
  context_dev_html: string;
  json_ld_parse_failures: number;
}

export interface AuditResult {
  url: string;
  host: string;
  title: string | null;
  description: string | null;
  fetched_at: string;
  score: number;
  band: AuditBand;
  top_priorities: string[];
  agent_prompts: AgentFixPrompts;
  stats: AuditStats;
  categories: AuditCategory[];
  diagnostics: AuditDiagnostics;
}

/** List-view row: no result blob. */
export interface SeoAuditSummary {
  id: string;
  url: string;
  host: string;
  score: number;
  band: string;
  created_at: string;
}

/** One stored audit plus its full scored result. */
export interface StoredAudit extends SeoAuditSummary {
  /** True when the backend served this from the stored-audit cache. */
  cached: boolean;
  audit: AuditResult;
}

// --- Presentation helpers ---------------------------------------------

export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  pass: "Pass",
  partial: "Partial",
  fail: "Fail",
  na: "Didn't apply",
};

/** Theme-token classes per status. `na` is deliberately neutral/muted - it
 *  must never read in the same register as `fail`. */
export const AUDIT_STATUS_CLASSES: Record<AuditStatus, string> = {
  pass: "border-success/25 bg-success/10 text-success",
  partial: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  fail: "border-destructive/30 bg-destructive/10 text-destructive",
  na: "border-border bg-muted/50 text-muted-foreground",
};

/** Score-band accent, keyed off the band label the backend assigns. */
export function bandClass(band: string): string {
  switch (band) {
    case "Excellent":
    case "Strong":
      return "text-success";
    case "Average":
      return "text-amber-700 dark:text-amber-400";
    default:
      return "text-destructive";
  }
}

// --- Read (SWR) --------------------------------------------------------

const SEO_AUDITS = "/api/v1/seo-audits";

export const seoAuditKeys = {
  list: (limit = 50) => `${SEO_AUDITS}?limit=${limit}`,
  detail: (id: string) => `${SEO_AUDITS}/${encodeURIComponent(id)}`,
};

export const seoAuditsFetcher = clientFetch<SeoAuditSummary[]>;

/** Browser URL for the text/plain agent-prompt download (Content-Disposition
 *  attachment is set upstream and passes straight through the proxy). */
export function promptDownloadUrl(id: string): string {
  return `/api/proxy${SEO_AUDITS}/${encodeURIComponent(id)}/prompt`;
}

// --- Writes (proxy) ----------------------------------------------------

async function proxyMutate<T>(
  path: string,
  method: "POST" | "DELETE",
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
  return (await res.json()) as T;
}

/**
 * Run an audit. SYNCHRONOUS on the backend - two page scrapes plus scoring,
 * routinely ~30s. There is no job row to poll, so the caller must keep a
 * pending UI up for the whole round trip rather than expecting a job id.
 *
 * A 409 means the deployment has the auditor switched off or Context.dev
 * unconfigured - a deployment state, not a user error. Callers should render a
 * calm "not configured" panel for it (see `isNotConfigured`).
 */
export function runSeoAudit(url: string, refresh = false): Promise<StoredAudit> {
  return proxyMutate<StoredAudit>(SEO_AUDITS, "POST", { url, refresh });
}

export function deleteSeoAudit(id: string): Promise<void> {
  return proxyMutate<void>(`${SEO_AUDITS}/${encodeURIComponent(id)}`, "DELETE");
}

/** The auditor is off / unconfigured for this deployment (fail-closed 409). */
export function isNotConfigured(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

/** The vendor was reachable but unavailable (502) - retrying may work. */
export function isVendorOutage(e: unknown): boolean {
  return e instanceof ApiError && e.status === 502;
}

/** Strip the leading status code + FastAPI `{"detail": ...}` envelope so the
 *  message we surface is the sentence the backend actually wrote. */
export function auditErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.message.replace(/^\d+\s*/, "");
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
    } catch {
      /* not JSON - fall through to the raw text */
    }
    return body || `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
