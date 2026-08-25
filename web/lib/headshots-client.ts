// Client-safe typed client for the Headshot Studio API (/api/v1/headshots).
// SWR keys are plain backend paths (clientFetch prefixes /api/proxy);
// mutations POST/DELETE through the proxy so the Clerk JWT is attached
// server-side - including the multipart source upload, which the proxy
// forwards as a raw binary body. Image URLs are already proxy-prefixed
// because an <img src> can't carry a bearer token. No server-only imports.

import { clientFetch } from "@/lib/client-fetcher";

const HS = "/api/v1/headshots";

// ------------------------------------------------------------------- types

/** One catalog style. The four prompt axes are exposed separately, plus
 *  `prompt_preview` - the exact language the model will be told. */
export interface HeadshotStyle {
  key: string;
  label: string;
  description: string;
  best_for: string;
  wardrobe: string;
  lighting: string;
  background: string;
  lens: string;
  prompt_preview: string;
}

export type HeadshotBatchStatus = "queued" | "running" | "done" | "partial" | "failed";
export type HeadshotVariantStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface HeadshotBatch {
  id: string;
  user_id: string;
  niche_id: string | null;
  style_key: string;
  subject_notes: string;
  variant_count: number;
  source_image_ids: string[];
  status: HeadshotBatchStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface HeadshotVariant {
  id: string;
  variant_index: number;
  status: HeadshotVariantStatus;
  error: string | null;
  has_image: boolean;
}

export interface HeadshotBatchDetail {
  batch: HeadshotBatch;
  variants: HeadshotVariant[];
}

/** What POST /sources answers with. `url` is the *backend* path; use
 *  `headshotSourceImageUrl` for something an <img> can load. */
export interface HeadshotSource {
  id: string;
  url: string;
}

// Mirrors the server-side validation in marketer.headshots.pipeline, so the
// picker can reject the obvious cases before spending an upload round-trip.
// The server is still the authority - its rejections are surfaced verbatim.
export const ALLOWED_SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_SOURCE_IMAGES = 6;
export const MAX_SUBJECT_NOTES_CHARS = 400;
export const MIN_VARIANTS = 1;
export const MAX_VARIANTS = 12;

// -------------------------------------------------------------------- keys

export const headshotKeys = {
  styles: () => `${HS}/styles`,
  batches: (status?: string, limit = 50) =>
    `${HS}?limit=${limit}${status ? `&status=${status}` : ""}`,
  batch: (id: string) => `${HS}/${id}`,
};

export function headshotVariantImageUrl(
  batchId: string,
  variantId: string,
  nonce?: number,
): string {
  const q = nonce ? `?r=${nonce}` : "";
  return `/api/proxy${HS}/${batchId}/variants/${variantId}/image${q}`;
}

export function headshotSourceImageUrl(sourceId: string): string {
  return `/api/proxy${HS}/sources/${sourceId}/image`;
}

// --------------------------------------------------------------- lifecycle

const BATCH_TERMINAL: ReadonlySet<HeadshotBatchStatus> = new Set([
  "done",
  "partial",
  "failed",
]);

export function isBatchActive(b: Pick<HeadshotBatch, "status">): boolean {
  return !BATCH_TERMINAL.has(b.status);
}

/** Retry only claims a batch that has gaps to fill. */
export function canRetryBatch(b: Pick<HeadshotBatch, "status">): boolean {
  return b.status === "failed" || b.status === "partial";
}

export function isVariantPending(v: Pick<HeadshotVariant, "status">): boolean {
  return v.status === "queued" || v.status === "running";
}

/** The lane fails closed on config: with no image key the write endpoints
 *  answer 409 while the style catalog stays readable. */
export function isNotConfigured(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("409");
}

/** Turn a proxy error into the message the backend actually sent. Upload
 *  rejections (bad type, oversize, wrong magic bytes) arrive as a 400 with a
 *  JSON `{"detail": "..."}` body, and the raw form is unreadable. */
export function readableError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const match = /^\d{3}\s+([\s\S]*)$/.exec(err.message);
  const body = (match ? match[1] : err.message).trim();
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail;
  } catch {
    // Not JSON - fall through and show the raw text.
  }
  return body;
}

// --------------------------------------------------------------- mutations

async function proxy<T>(
  method: "POST" | "DELETE",
  path: string,
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
    throw new Error(`${res.status} ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? ((await res.json()) as T) : (undefined as T);
}

/** Upload one reference photo. Sent as multipart/form-data with the field
 *  name `file` - the content-type header is deliberately NOT set so the
 *  browser can add the multipart boundary. */
export async function uploadHeadshotSource(file: File): Promise<HeadshotSource> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/proxy${HS}/sources`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as HeadshotSource;
}

export function deleteHeadshotSource(id: string): Promise<void> {
  return proxy("DELETE", `${HS}/sources/${id}`);
}

export function createHeadshotBatch(body: {
  style_key: string;
  source_image_ids: string[];
  variant_count?: number;
  subject_notes?: string;
  niche_id?: string | null;
}): Promise<HeadshotBatch> {
  return proxy("POST", HS, {
    style_key: body.style_key,
    source_image_ids: body.source_image_ids,
    variant_count: body.variant_count ?? 4,
    subject_notes: body.subject_notes ?? "",
    niche_id: body.niche_id ?? null,
  });
}

/** Re-render only the variants that have nothing to show. */
export function retryHeadshotBatch(id: string): Promise<HeadshotBatch> {
  return proxy("POST", `${HS}/${id}/retry`);
}

/** Delete the batch, its variants, and the portraits on disk. */
export function deleteHeadshotBatch(id: string): Promise<void> {
  return proxy("DELETE", `${HS}/${id}`);
}

export function fetchHeadshotBatches(
  status?: string,
  limit = 50,
): Promise<HeadshotBatch[]> {
  return clientFetch<HeadshotBatch[]>(headshotKeys.batches(status, limit));
}
