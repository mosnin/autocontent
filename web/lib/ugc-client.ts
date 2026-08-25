// Client-safe typed client for the UGC studio API (/api/v1/ugc). SWR keys are
// plain backend paths (clientFetch prefixes /api/proxy); mutations
// POST/DELETE through the proxy so the Clerk JWT is attached server-side -
// `auth()` can't run in the browser. No server-only imports.
//
// Types mirror backend/routes/ugc.py + src/marketer/ugc/catalog.py field for
// field. The catalog is the *only* source of truth for which parameter
// combinations the backend will accept, so the capability helpers at the
// bottom (defaultParams / clampParams / durationOptions / estimateCostUsd)
// exist so the UI can never post a combination validate_params() would 400.

import { clientFetch } from "@/lib/client-fetcher";

const UGC = "/api/v1/ugc";

// ---------------------------------------------------------------- catalog

/** `UgcModel.duration_spec()` - a closed option set OR an inclusive range. */
export type UgcDurationSpec =
  | { kind: "options"; options: number[]; default: number }
  | { kind: "range"; min: number; max: number; default: number };

/** `pricing.cost_basis()` - USD per rendered second, keyed by resolution
 *  when the model has a resolution knob, flat when it doesn't. */
export interface UgcCostBasis {
  unit: string;
  by_resolution?: Record<string, string>;
  flat?: string;
}

export interface UgcModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  aspect_ratios: string[];
  default_aspect_ratio: string;
  duration: UgcDurationSpec;
  /** Empty = this endpoint has no resolution parameter at all. Sending one
   *  anyway is a 400, not a silently-dropped field. */
  resolutions: string[];
  default_resolution: string;
  /** Empty = no content-mode parameter (Grok only). */
  modes: string[];
  default_mode: string;
  cost_basis: UgcCostBasis;
}

export interface UgcModelCatalog {
  models: UgcModel[];
  max_reference_images: number;
}

// ---------------------------------------------------------------- renders

export type UgcStatus = "queued" | "running" | "done" | "failed";
export type UgcRenderMode = "text_to_video" | "image_to_video";

/** One `ugc_renders` row (migration 0028), as the repo serializes it. */
export interface UgcRender {
  id: string;
  user_id: string;
  niche_id: string | null;
  model_id: string;
  prompt: string;
  render_mode: UgcRenderMode;
  /** "" when the model has no such knob. */
  aspect_ratio: string;
  resolution: string;
  mode: string;
  duration_sec: number;
  image_urls: string[];
  provider: string;
  provider_request_id: string | null;
  status: UgcStatus;
  video_url: string | null;
  error: string | null;
  /** numeric(10,4), serialized as a string. */
  est_cost_usd: string;
  created_at: string;
  updated_at: string;
}

export interface UgcRenderCreate {
  model_id: string;
  prompt: string;
  aspect_ratio?: string | null;
  duration?: number | null;
  resolution?: string | null;
  mode?: string | null;
  image_urls: string[];
  niche_id?: string | null;
}

export const UGC_TERMINAL: ReadonlySet<UgcStatus> = new Set<UgcStatus>([
  "done",
  "failed",
]);

export function isUgcTerminal(render: UgcRender): boolean {
  return UGC_TERMINAL.has(render.status);
}

export const ugcKeys = {
  models: () => `${UGC}/models`,
  renders: (status?: string, limit = 50) =>
    `${UGC}/renders?limit=${limit}${status ? `&status_filter=${status}` : ""}`,
  render: (id: string) => `${UGC}/renders/${id}`,
};

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

/** 202 + the queued row. 400 on a parameter the model doesn't declare, 402
 *  when metering refuses, 409 when the studio is unconfigured. */
export function createRender(body: UgcRenderCreate): Promise<UgcRender> {
  return proxy("POST", `${UGC}/renders`, body);
}

/** 202. Atomic failed -> queued; 409 when the render isn't failed. */
export function retryRender(id: string): Promise<UgcRender> {
  return proxy("POST", `${UGC}/renders/${id}/retry`);
}

/** 204, no body. */
export function deleteRender(id: string): Promise<void> {
  return proxy("DELETE", `${UGC}/renders/${id}`);
}

export function fetchModels(): Promise<UgcModelCatalog> {
  return clientFetch<UgcModelCatalog>(ugcKeys.models());
}

// ------------------------------------------------- capability resolution

/** The four adaptive knobs, resolved against one model. `resolution` and
 *  `mode` are "" for models with no such parameter - the POST sends null
 *  in that case, because a non-empty value is a hard 400. */
export interface UgcParams {
  aspect_ratio: string;
  duration: number;
  resolution: string;
  mode: string;
}

/** Every duration a model accepts, ascending. A range model is enumerated
 *  at 1s steps so a select and a slider can share one source. */
export function durationValues(spec: UgcDurationSpec): number[] {
  if (spec.kind === "options") return [...spec.options].sort((a, b) => a - b);
  const out: number[] = [];
  for (let s = spec.min; s <= spec.max; s += 1) out.push(s);
  return out;
}

export function allowsDuration(spec: UgcDurationSpec, seconds: number): boolean {
  return spec.kind === "options"
    ? spec.options.includes(seconds)
    : seconds >= spec.min && seconds <= spec.max;
}

export function defaultParams(model: UgcModel): UgcParams {
  return {
    aspect_ratio: model.default_aspect_ratio,
    duration: model.duration.default,
    resolution: model.resolutions.length > 0 ? model.default_resolution : "",
    mode: model.modes.length > 0 ? model.default_mode : "",
  };
}

function nearest(values: number[], target: number): number {
  return values.reduce(
    (best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best),
    values[0],
  );
}

/**
 * Re-clamp the current parameter selection onto a (possibly different)
 * model. This is what makes switching models safe: intent is preserved
 * where the new model supports it, and silently corrected where it does
 * not, so the form can never hold a combination the backend rejects.
 *
 *   aspect ratio - kept when supported, else the model's default.
 *   duration     - nearest allowed option, or clamped into the range.
 *   resolution   - kept when supported, else default; forced to "" when the
 *                  model has no resolution parameter.
 *   mode         - same rule as resolution.
 */
export function clampParams(model: UgcModel, current: Partial<UgcParams>): UgcParams {
  const fallback = defaultParams(model);

  const aspect =
    current.aspect_ratio && model.aspect_ratios.includes(current.aspect_ratio)
      ? current.aspect_ratio
      : fallback.aspect_ratio;

  let duration = fallback.duration;
  if (typeof current.duration === "number" && Number.isFinite(current.duration)) {
    if (allowsDuration(model.duration, current.duration)) {
      duration = current.duration;
    } else if (model.duration.kind === "options") {
      duration = nearest(durationValues(model.duration), current.duration);
    } else {
      duration = Math.min(
        model.duration.max,
        Math.max(model.duration.min, Math.round(current.duration)),
      );
    }
  }

  const resolution =
    model.resolutions.length === 0
      ? ""
      : current.resolution && model.resolutions.includes(current.resolution)
        ? current.resolution
        : fallback.resolution;

  const mode =
    model.modes.length === 0
      ? ""
      : current.mode && model.modes.includes(current.mode)
        ? current.mode
        : fallback.mode;

  return { aspect_ratio: aspect, duration, resolution, mode };
}

/** USD per rendered second for the chosen resolution, or null when the
 *  catalog carries no pinned price (the backend refuses to render then). */
export function usdPerSecond(model: UgcModel, resolution: string): number | null {
  const basis = model.cost_basis;
  const raw =
    model.resolutions.length > 0
      ? (basis.by_resolution ?? {})[resolution]
      : basis.flat;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The same arithmetic metering will do at submit time, so the estimate the
 *  user sees is the number that gets charged. */
export function estimateCostUsd(model: UgcModel, params: UgcParams): number | null {
  const rate = usdPerSecond(model, params.resolution);
  return rate === null ? null : rate * params.duration;
}

// ------------------------------------------------------- @imageN helpers

const IMAGE_REF = /@image(\d+)/g;

/** Every `@imageN` index in a script, in order of appearance (1-based, in
 *  upload order) - mirrors ugc/prompts.parse_image_refs. */
export function parseImageRefs(prompt: string): number[] {
  return [...(prompt ?? "").matchAll(IMAGE_REF)].map((m) => Number(m[1]));
}

/** The client-side twin of validate_image_refs: returns the dangling
 *  references so the composer can warn before the 400 costs a round trip. */
export function danglingImageRefs(prompt: string, imageCount: number): number[] {
  const refs = parseImageRefs(prompt);
  return [...new Set(refs.filter((n) => n < 1 || n > imageCount))].sort((a, b) => a - b);
}
