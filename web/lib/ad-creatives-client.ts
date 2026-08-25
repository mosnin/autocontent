// Client-safe typed client for the Ad Creative Studio API
// (/api/v1/ad-creatives). SWR keys are plain backend paths (clientFetch
// prefixes /api/proxy); mutations POST through the proxy so the Clerk JWT is
// attached server-side. Image URLs are already proxy-prefixed because an
// <img src> can't carry a bearer token. No server-only imports - this runs in
// the browser.

import { clientFetch } from "@/lib/client-fetcher";

const ADC = "/api/v1/ad-creatives";

// ------------------------------------------------------------------- types

/** One extracted brand color. `hex` is display-only - it never reaches a
 *  prompt (the backend sends plain-English phrases as color_a/color_b). */
export interface AdBrandColor {
  hex: string;
  name: string | null;
}

/** The normalized Brief a run was planned from. Rows start life with an
 *  empty `{}` brief, so every field is optional on the wire. */
export interface AdRunBrief {
  domain?: string;
  brand_name?: string;
  description?: string;
  industry?: string;
  summary?: string;
  mood?: string;
  font_family?: string | null;
  color_a?: string;
  color_b?: string;
  logo_url?: string | null;
  colors?: AdBrandColor[];
}

export type AdRunStatus = "queued" | "planning" | "rendering" | "done" | "failed";
export type AdSlotStatus = "queued" | "rendering" | "done" | "failed";

export interface AdRun {
  id: string;
  user_id: string;
  niche_id: string | null;
  domain: string;
  brand_name: string;
  status: AdRunStatus;
  brief: AdRunBrief;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** The gallery's view of one Ad Slot. Labels/display names are resolved by
 *  the backend at read time, so a catalog rename shows up on old runs. */
export interface AdSlot {
  id: string;
  position: number;
  direction_key: string;
  direction_label: string;
  image_model_id: string;
  image_model_name: string;
  subject_kind: "company" | "product";
  product_name: string;
  headline: string;
  subheadline: string;
  status: AdSlotStatus;
  error: string | null;
}

export interface AdRunDetail {
  run: AdRun;
  slots: AdSlot[];
}

// -------------------------------------------------------------------- keys

export const adCreativeKeys = {
  runs: (limit = 50) => `${ADC}?limit=${limit}`,
  run: (id: string) => `${ADC}/${id}`,
};

/** Streaming PNG for one rendered slot, through the proxy so the JWT is
 *  attached. `nonce` busts the browser cache after a retry re-renders. */
export function adSlotImageUrl(
  runId: string,
  slotId: string,
  nonce?: number,
): string {
  const q = nonce ? `?r=${nonce}` : "";
  return `/api/proxy${ADC}/${runId}/slots/${slotId}/image${q}`;
}

// --------------------------------------------------------------- lifecycle

const RUN_TERMINAL: ReadonlySet<AdRunStatus> = new Set(["done", "failed"]);

export function isRunActive(run: Pick<AdRun, "status">): boolean {
  return !RUN_TERMINAL.has(run.status);
}

export function isSlotPending(slot: Pick<AdSlot, "status">): boolean {
  return slot.status === "queued" || slot.status === "rendering";
}

/** The studio is config-gated (feature flag + a research vendor key) and
 *  fails closed with a 409 on every write. Used to swap the composer for a
 *  calm "not configured" notice instead of shouting a raw error. */
export function isNotConfigured(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("409");
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

/** Enqueue a run. 202 + the run row; rejects with a 422 message for a
 *  domain that isn't a public website, or a 409 when the lane is off. */
export function createAdRun(body: {
  domain: string;
  niche_id?: string | null;
}): Promise<AdRun> {
  return proxy("POST", ADC, {
    domain: body.domain,
    niche_id: body.niche_id ?? null,
  });
}

/** Re-render one failed slot against the run's stored plan. */
export function retryAdSlot(
  runId: string,
  slotId: string,
): Promise<{ status: string }> {
  return proxy("POST", `${ADC}/${runId}/slots/${slotId}/retry`);
}

/** Typed convenience wrapper around the list endpoint (server components
 *  use `api()` directly; this is here for symmetry with the SWR key). */
export function fetchAdRuns(limit = 50): Promise<AdRun[]> {
  return clientFetch<AdRun[]>(adCreativeKeys.runs(limit));
}
