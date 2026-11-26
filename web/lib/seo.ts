// SEO article extensions (backend 0035, docs/seo-articles.md). Pure + client-safe.
import type { Article } from "@/lib/types";

export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 155;
export const SLUG_MAX = 80;
export const SECONDARY_MAX = 10;

export interface ResearchSource {
  url: string;
  title: string;
  domain: string;
  snippet: string;
}

export interface ArticleResearch {
  query: string;
  model: string;
  notes: string;
  sources: ResearchSource[];
  flagged: number;
  fetched_at: string | null;
}

export interface UnsplashCover {
  source: "unsplash";
  id: string;
  url: string;
  thumb_url: string;
  alt: string;
  author_name: string;
  author_url: string;
  photo_url: string;
  unsplash_url: string;
  attribution: string;
}

export type PublishStatus = "none" | "scheduled" | "publishing" | "published" | "failed" | "unknown" | "needs_review";

export interface SeoFields {
  research?: ArticleResearch | null;
  meta_title?: string | null;
  cover_image?: UnsplashCover | null;
  publish_status?: PublishStatus;
  publish_mode?: "draft" | "live" | null;
  publish_at?: string | null;
  publish_error?: string | null;
  wp_post_id?: number | null;
  wp_post_url?: string | null;
  published_at?: string | null;
  batch_id?: string | null;
}

export type SeoArticle = Article & SeoFields;

export interface WordPressConnection {
  connected: boolean;
  site_url: string | null;
  username: string | null;
  seo_plugin: "yoast" | "rankmath" | "none" | null;
  status: "active" | "error" | null;
  last_error: string;
  has_password: boolean;
  can_publish: boolean | null;
  secrets_configured: boolean;
}

export interface UnsplashPhoto {
  id: string;
  url: string;
  thumb_url: string;
  alt: string;
  width: number | null;
  height: number | null;
  author_name: string;
  author_url: string;
  photo_url: string;
  unsplash_url: string;
}

export interface BatchItem {
  id: string;
  position: number;
  keyword: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  held_reason: string | null;
  article_id: string | null;
  error: string | null;
}

export interface ArticleBatch {
  id: string;
  niche_id: string;
  status: "running" | "paused_cap" | "done" | "cancelled";
  total: number;
  created_at: string;
  items: BatchItem[];
}

export const SEO_PLUGIN_LABEL: Record<string, string> = { yoast: "Yoast SEO", rankmath: "Rank Math", none: "No SEO plugin" };

/** What a person sees for the publish state. */
export function publishLabel(a: SeoFields): { label: string; tone: "neutral" | "positive" | "negative" | "attention" | "accent" } | null {
  switch (a.publish_status) {
    case "scheduled":
      return { label: "Scheduled", tone: "accent" };
    case "publishing":
      return { label: "Publishing", tone: "neutral" };
    case "published":
      return a.published_at ? { label: "Live on WordPress", tone: "positive" } : { label: "Draft on WordPress", tone: "neutral" };
    case "failed":
      return { label: "Didn't publish", tone: "negative" };
    case "unknown":
      return { label: "Check WordPress", tone: "attention" };
    case "needs_review":
      return { label: "Needs a look", tone: "attention" };
    default:
      return null;
  }
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export interface MetaDraft {
  meta_title: string;
  meta_description: string;
  slug: string;
  focus_keyword: string;
  secondary_keywords: string[];
}

/** Mirror of backend articles/seo_meta.validate: field -> problem. */
export function validateMeta(d: MetaDraft): Partial<Record<keyof MetaDraft, string>> {
  const e: Partial<Record<keyof MetaDraft, string>> = {};
  const t = clean(d.meta_title);
  if (!t) e.meta_title = "Add a meta title.";
  else if (t.length > META_TITLE_MAX) e.meta_title = `Keep it to ${META_TITLE_MAX} characters.`;
  const desc = clean(d.meta_description);
  if (!desc) e.meta_description = "Add a meta description.";
  else if (desc.length > META_DESCRIPTION_MAX) e.meta_description = `Keep it to ${META_DESCRIPTION_MAX} characters.`;
  if (!d.slug) e.slug = "Add a slug.";
  else if (d.slug.length > SLUG_MAX) e.slug = `Keep it to ${SLUG_MAX} characters.`;
  else if (!SLUG_RE.test(d.slug)) e.slug = "Lowercase letters, numbers and single hyphens.";
  const f = clean(d.focus_keyword);
  if (!f) e.focus_keyword = "Add a focus keyword.";
  const seen = new Set([f.toLowerCase()]);
  if (d.secondary_keywords.length > SECONDARY_MAX) e.secondary_keywords = `At most ${SECONDARY_MAX}.`;
  else
    for (const k of d.secondary_keywords) {
      const c = clean(k).toLowerCase();
      if (seen.has(c)) {
        e.secondary_keywords = `“${clean(k)}” is listed twice, or is the focus keyword.`;
        break;
      }
      seen.add(c);
    }
  return e;
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Parse a keyword list (one per line), trimmed and deduped, order kept. */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const k = clean(line);
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

/** Move an ISO instant to another local day, keeping its local time of day. */
export function moveToDay(iso: string, day: string): Date {
  const src = new Date(iso);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const out = new Date(src);
  out.setFullYear(y, m - 1, d);
  return out;
}

/** Only https links are rendered clickable. */
export const httpsOnly = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) ? u : null);
