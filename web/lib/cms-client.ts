// Client-safe typed client for the article CMS (/api/v1/cms).
//
// Reads use SWR keys that are plain backend paths — `clientFetch` prefixes
// /api/proxy for us. Mutations go through the same /api/proxy/... handler so
// the Clerk JWT is attached server-side. NOTHING here may import server-only
// modules — this file runs in the browser.
//
// Shapes mirror `src/marketer/cms/schemas.py` field for field; the guard
// codes mirror `src/marketer/cms/publish.py`.
//
// CONTRACT GAP worth knowing: there is no `GET /cms/articles/{id}`.
// `GET /api/v1/articles/{id}` returns the *pipeline* model, which drops
// publication_state/published_at/scheduled_at. The only reads that expose
// publication state are `by-slug` (published rows only) and the responses of
// the mutations below — so the UI treats every mutation response as the
// authoritative publication state and probes by-slug for the initial one.

import { ApiError, clientFetch } from "@/lib/client-fetcher";

// --- Wire types --------------------------------------------------------

/** Where the article sits relative to the public web. Orthogonal to the
 *  pipeline `status`: a `done` article may be a draft. */
export type PublicationState = "draft" | "scheduled" | "published";

export type RevisionSource = "edit" | "restore";

/** The four fields a human may hand-edit, in the order they are shown. */
export const EDITABLE_FIELDS = [
  "title",
  "slug",
  "meta_description",
  "article_markdown",
] as const;

export interface CmsArticle {
  id: string;
  user_id: string;
  niche_id: string;
  /** Pipeline status ('queued'..'done'|'failed'). Only 'done' may publish. */
  status: string;
  publication_state: PublicationState;
  title: string | null;
  slug: string | null;
  meta_description: string | null;
  article_markdown: string | null;
  word_count: number | null;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** PATCH body — every field optional, an omitted field is untouched. */
export interface ArticleEdit {
  title?: string;
  slug?: string;
  meta_description?: string;
  article_markdown?: string;
}

/** List-view row: what changed and when, without the content blob. */
export interface RevisionSummary {
  id: string;
  article_id: string;
  revision_number: number;
  changed_fields: string[];
  summary: string;
  source: RevisionSource;
  restored_from_revision_id: string | null;
  created_at: string | null;
}

/** One revision including the full snapshot of the content it replaced. */
export interface Revision extends RevisionSummary {
  title: string | null;
  slug: string | null;
  meta_description: string | null;
  article_markdown: string | null;
}

/** The updated article plus the revision the edit captured (null when the
 *  PATCH changed nothing). */
export interface EditResult {
  article: CmsArticle;
  revision: RevisionSummary | null;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string;
  article_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface CollectionCreate {
  name: string;
  description?: string;
  slug?: string | null;
}

export interface AssignResult {
  collection_id: string;
  added: number;
  /** Full membership after the call. */
  article_ids: string[];
}

export interface BulkTopicsAccepted {
  queued: number;
  article_ids: string[];
  /** Topics dropped as duplicates within the same request. */
  skipped: string[];
}

// --- Publication helpers ----------------------------------------------

export const PUBLICATION_LABELS: Record<PublicationState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
};

/**
 * The slug of an article that has EVER been public is frozen server-side
 * (`guard_slug_change`): unpublishing does not release it, because the old
 * URL must never resolve to different content. Mirrored here so the UI can
 * lock the field instead of letting the user type a change that 409s.
 */
export function isSlugFrozen(a: Pick<CmsArticle, "publication_state" | "published_at">): boolean {
  return a.publication_state !== "draft" || Boolean(a.published_at);
}

/** The publish guards, evaluated client-side so the button can explain
 *  itself instead of the user discovering the 409. Returns null when the
 *  article is publishable. */
export function publishBlocker(a: CmsArticle): string | null {
  if (!(a.article_markdown ?? "").trim()) return "This article has no content yet.";
  if (!(a.title ?? "").trim()) return "This article has no title yet.";
  if (a.status !== "done")
    return `Generation is '${a.status}', not 'done' — publishing mid-run ships content that is still being rewritten.`;
  if (!(a.slug ?? "").trim() && !(a.title ?? "").trim())
    return "There is no usable slug or title for a URL.";
  return null;
}

// --- Read (SWR) --------------------------------------------------------

const CMS = "/api/v1/cms";

export const cmsKeys = {
  revisions: (articleId: string) =>
    `${CMS}/articles/${encodeURIComponent(articleId)}/revisions`,
  revision: (articleId: string, revisionId: string) =>
    `${CMS}/articles/${encodeURIComponent(articleId)}/revisions/${encodeURIComponent(revisionId)}`,
  collections: () => `${CMS}/collections`,
  bySlug: (slug: string) => `${CMS}/articles/by-slug/${encodeURIComponent(slug)}`,
};

export const revisionsFetcher = clientFetch<RevisionSummary[]>;
export const collectionsFetcher = clientFetch<Collection[]>;

export function getRevision(articleId: string, revisionId: string): Promise<Revision> {
  return clientFetch<Revision>(cmsKeys.revision(articleId, revisionId));
}

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

/** Hand-edit. The prior version is captured as a revision first, in the
 *  same transaction. */
export function editArticle(id: string, edit: ArticleEdit): Promise<EditResult> {
  return proxyMutate<EditResult>(`${CMS}/articles/${encodeURIComponent(id)}`, "PATCH", edit);
}

/** Restore a revision's content AS A NEW revision — history is never
 *  rewound or deleted. */
export function restoreRevision(id: string, revisionId: string): Promise<EditResult> {
  return proxyMutate<EditResult>(
    `${CMS}/articles/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    "POST",
  );
}

/** `scheduled_at: null` publishes immediately; a future instant schedules.
 *  Idempotent — a re-publish returns the article with its original
 *  published_at rather than re-stamping it. */
export function publishArticle(
  id: string,
  scheduledAt: string | null = null,
): Promise<CmsArticle> {
  return proxyMutate<CmsArticle>(
    `${CMS}/articles/${encodeURIComponent(id)}/publish`,
    "POST",
    { scheduled_at: scheduledAt },
  );
}

/** Back to draft (or cancel a schedule). The slug is NOT released. */
export function unpublishArticle(id: string): Promise<CmsArticle> {
  return proxyMutate<CmsArticle>(
    `${CMS}/articles/${encodeURIComponent(id)}/unpublish`,
    "POST",
  );
}

export function createCollection(body: CollectionCreate): Promise<Collection> {
  return proxyMutate<Collection>(`${CMS}/collections`, "POST", body);
}

export function updateCollection(
  id: string,
  body: Partial<CollectionCreate>,
): Promise<Collection> {
  return proxyMutate<Collection>(
    `${CMS}/collections/${encodeURIComponent(id)}`,
    "PATCH",
    body,
  );
}

export function deleteCollection(id: string): Promise<void> {
  return proxyMutate<void>(`${CMS}/collections/${encodeURIComponent(id)}`, "DELETE");
}

/** Idempotent; unknown or foreign article ids are skipped, not errors. */
export function assignToCollection(
  collectionId: string,
  articleIds: string[],
): Promise<AssignResult> {
  return proxyMutate<AssignResult>(
    `${CMS}/collections/${encodeURIComponent(collectionId)}/articles`,
    "POST",
    { article_ids: articleIds },
  );
}

/** Queue one pipeline run per topic (202). Each topic is real spend. */
export function queueBulkTopics(
  nicheId: string,
  topics: string[],
): Promise<BulkTopicsAccepted> {
  return proxyMutate<BulkTopicsAccepted>(`${CMS}/bulk-topics`, "POST", {
    niche_id: nicheId,
    topics,
  });
}

// --- Errors ------------------------------------------------------------

/** Every publication guard is a 409 whose detail carries a stable `code`
 *  (`slug_frozen`, `no_content`, `not_finished`, `slug_taken`, ...) so a
 *  client can branch without string-matching prose. */
export interface CmsError {
  status: number;
  code: string | null;
  message: string;
}

export function cmsError(e: unknown): CmsError {
  if (e instanceof ApiError) {
    const body = e.message.replace(/^\d+\s*/, "");
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      const detail = parsed.detail;
      if (detail && typeof detail === "object" && !Array.isArray(detail)) {
        const d = detail as { code?: string; message?: string };
        return {
          status: e.status,
          code: d.code ?? null,
          message: d.message ?? body,
        };
      }
      if (typeof detail === "string") {
        return { status: e.status, code: null, message: detail };
      }
      if (Array.isArray(detail)) {
        const first = detail[0] as { msg?: string } | undefined;
        return { status: e.status, code: null, message: first?.msg ?? body };
      }
    } catch {
      /* not JSON — fall through */
    }
    return { status: e.status, code: null, message: body || `Request failed (${e.status})` };
  }
  return {
    status: 0,
    code: null,
    message: e instanceof Error ? e.message : "Something went wrong",
  };
}

/** A 404 from `by-slug` is "not currently published", not an error. */
export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}
