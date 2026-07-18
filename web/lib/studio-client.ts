// Client-safe typed client for the Content Studio API (/api/v1/studio) and
// the Media Library API (/api/v1/media), plus the two job-revision endpoints
// the queue's Scenes tab drives (/api/v1/jobs/{id}/scenes/{index}/reroll and
// /api/v1/jobs/{id}/revoice). Reads go through SWR with `clientFetch` (see
// lib/client-fetcher.ts); writes POST/DELETE through the same
// /api/proxy/... handler so the Clerk JWT is attached server-side. No
// server-only imports — this runs in the browser.

import { ApiError, clientFetch } from "@/lib/client-fetcher";
import type { Job } from "@/lib/types";

const STUDIO = "/api/v1/studio";
const MEDIA = "/api/v1/media";

export type MediaKind = "image" | "video" | "audio";
export type MediaSource = "pipeline" | "studio" | "upload";

export interface MediaAssetMeta {
  model?: string;
  prompt?: string | null;
  parent_media_id?: string | null;
  [key: string]: unknown;
}

export interface MediaAsset {
  id: string;
  user_id: string;
  niche_id: string | null;
  job_id: string | null;
  article_id: string | null;
  kind: MediaKind;
  source: MediaSource;
  path: string;
  url: string;
  mime: string;
  meta: MediaAssetMeta;
  created_at: string;
  deleted_at: string | null;
}

export interface MediaAssetPage {
  items: MediaAsset[];
  next_cursor: string | null;
}

/** The proxied URL for an asset's raw bytes — usable directly as an
 *  <img src> / <video src>. Goes through the Next proxy so the Clerk JWT
 *  is attached server-side, same as every other authenticated request. */
export function mediaFileUrl(id: string): string {
  return `/api/proxy${MEDIA}/${encodeURIComponent(id)}/file`;
}

export interface ListMediaParams {
  kind?: MediaKind;
  source?: MediaSource;
  limit?: number;
  cursor?: string | null;
}

export function mediaListKey(params: ListMediaParams): string {
  const qs = new URLSearchParams();
  if (params.kind) qs.set("kind", params.kind);
  if (params.source) qs.set("source", params.source);
  qs.set("limit", String(params.limit ?? 48));
  if (params.cursor) qs.set("cursor", params.cursor);
  return `${MEDIA}?${qs.toString()}`;
}

export const mediaPageFetcher = clientFetch<MediaAssetPage>;

export function fetchMediaPage(params: ListMediaParams): Promise<MediaAssetPage> {
  return clientFetch<MediaAssetPage>(mediaListKey(params));
}

export function fetchMediaAsset(id: string): Promise<MediaAsset> {
  return clientFetch<MediaAsset>(`${MEDIA}/${encodeURIComponent(id)}`);
}

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

export function deleteMedia(id: string): Promise<void> {
  return proxyMutate<void>(`${MEDIA}/${encodeURIComponent(id)}`, "DELETE");
}

// --- Uploads ------------------------------------------------------------

const UPLOADS = "/api/v1/uploads";

/** Upload a file (image/video/audio) into the media library. Uses
 *  XMLHttpRequest (not fetch) so we can report real upload progress via
 *  `onProgress`. Goes through the same /api/proxy passthrough as every
 *  other write, so the Clerk JWT is attached server-side and the
 *  multipart body (with its boundary) is forwarded byte-for-byte. */
export function uploadMedia(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/proxy${UPLOADS}`);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as MediaAsset);
        } catch {
          reject(new ApiError(xhr.status, "bad response"));
        }
      } else {
        reject(new ApiError(xhr.status, xhr.responseText || `${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network error"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

// --- Model registries -------------------------------------------------
// Mirrors the fal_* defaults and allowlists in src/marketer/config.py and
// src/marketer/services/fal.py (MODEL_REGISTRY). Kept as a small hardcoded
// list here rather than fetched, since the backend doesn't expose the
// registry over the API and the allowlist rarely changes.

export interface ModelOption {
  id: string;
  label: string;
}

export const IMAGE_MODELS: ModelOption[] = [
  { id: "fal-ai/flux/dev", label: "Flux Dev (default)" },
  { id: "fal-ai/flux/schnell", label: "Flux Schnell (faster)" },
  { id: "fal-ai/flux-pro/v1.1", label: "Flux Pro v1.1" },
];

export const IMAGE_EDIT_MODELS: ModelOption[] = [
  { id: "fal-ai/flux-pro/v1/fill", label: "Flux Pro Fill (default)" },
  { id: "fal-ai/flux-pro/v1/canny", label: "Flux Pro Canny" },
];

export const UPSCALE_MODELS: ModelOption[] = [
  { id: "fal-ai/clarity-upscaler", label: "Clarity Upscaler (default)" },
  { id: "fal-ai/esrgan", label: "ESRGAN" },
];

export const VIDEO_MODELS: ModelOption[] = [
  {
    id: "fal-ai/kling-video/v1.5/standard/image-to-video",
    label: "Kling v1.5 Standard (default)",
  },
  {
    id: "fal-ai/kling-video/v1.5/pro/image-to-video",
    label: "Kling v1.5 Pro",
  },
];

// --- Content Studio tools ----------------------------------------------

export interface SourceRefInput {
  media_id?: string;
  image_url?: string;
}

export interface GenerateImageInput {
  prompt: string;
  model?: string;
  niche_id?: string;
}

export function generateImage(input: GenerateImageInput): Promise<MediaAsset> {
  return proxyMutate<MediaAsset>(`${STUDIO}/image`, "POST", cleanBody(input));
}

export interface EditImageInput extends SourceRefInput {
  prompt: string;
  model?: string;
  niche_id?: string;
}

export function editImage(input: EditImageInput): Promise<MediaAsset> {
  return proxyMutate<MediaAsset>(`${STUDIO}/image/edit`, "POST", cleanBody(input));
}

export interface UpscaleImageInput extends SourceRefInput {
  model?: string;
  niche_id?: string;
}

export function upscaleImage(input: UpscaleImageInput): Promise<MediaAsset> {
  return proxyMutate<MediaAsset>(`${STUDIO}/upscale`, "POST", cleanBody(input));
}

export interface RemoveBackgroundInput extends SourceRefInput {
  niche_id?: string;
}

export function removeBackground(input: RemoveBackgroundInput): Promise<MediaAsset> {
  return proxyMutate<MediaAsset>(`${STUDIO}/remove-bg`, "POST", cleanBody(input));
}

export interface AnimateImageInput extends SourceRefInput {
  prompt?: string;
  model?: string;
  niche_id?: string;
}

export function animateImage(input: AnimateImageInput): Promise<MediaAsset> {
  return proxyMutate<MediaAsset>(`${STUDIO}/video`, "POST", cleanBody(input));
}

// Strips undefined/empty-string keys so we never send e.g. `niche_id: ""`
// where the backend expects a UUID or omission.
function cleanBody<T extends object>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input) as [keyof T, unknown][]) {
    if (value === undefined || value === "") continue;
    out[key] = value as T[keyof T];
  }
  return out;
}

export interface StudioStatus {
  enabled: boolean;
}

/** Probe whether Content Studio is configured (MARKETER_FAL_API_KEY set)
 *  without spending anything or writing to the DB. remove-bg's body is
 *  entirely optional fields, and every studio route checks
 *  `fal.require_enabled()` before any DB work or spend pre-flight — so an
 *  empty-body POST either 503s (disabled) or 422s ("media_id or image_url
 *  is required", meaning it's enabled) before touching anything else. */
export async function probeStudioStatus(): Promise<StudioStatus> {
  const res = await fetch(`/api/proxy${STUDIO}/remove-bg`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
    cache: "no-store",
  });
  return { enabled: res.status !== 503 };
}

/** Turn an ApiError (or any thrown value) from this client into copy a
 *  user can read. Mirrors the humanizing convention in lib/press-client.ts. */
export function humanizeStudioError(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.message.replace(/^\d+\s*/, "");
    if (e.status === 503) {
      return "Studio isn't configured yet.";
    }
    if (e.status === 402) {
      return (
        extractDetail(body) ??
        "Spend cap or credit balance reached. Wait for it to reset or add credit."
      );
    }
    if (e.status === 422) {
      return extractDetail(body) ?? "That model isn't allowed for this tool.";
    }
    if (e.status === 502) {
      return "The AI call failed on the provider's end. Try again in a moment.";
    }
    if (e.status === 404) {
      return "That media asset couldn't be found. It may have been deleted.";
    }
    if (e.status === 409) {
      return extractDetail(body) ?? "That can't be done right now.";
    }
    if (e.status === 413) {
      return extractDetail(body) ?? "That file is too large.";
    }
    if (e.status === 415) {
      return extractDetail(body) ?? "That file type isn't supported.";
    }
    if (e.status >= 500) {
      return "Something went wrong on our end. Try again in a moment.";
    }
    return extractDetail(body) ?? body ?? `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

function extractDetail(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { detail?: string | Array<{ msg?: string }> };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) {
      return parsed.detail[0].msg ?? null;
    }
  } catch {
    // Not JSON — fall through.
  }
  return null;
}

// --- Job scene revisions (queue Scenes tab) -----------------------------

// Mirrors VOICE_OPTIONS in app/(app)/onboarding/OnboardingForm.tsx — kept
// in sync manually since that file doesn't export it.
export const VOICE_OPTIONS = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "ash",
  "sage",
  "coral",
] as const;
export type VoiceOption = (typeof VOICE_OPTIONS)[number];

/** Regenerate one scene's keyframe + clip. Returns the new revision job
 *  (202). 409 = source assets expired on the artifacts volume; point the
 *  user at Retry instead. */
export function rerollScene(
  jobId: string,
  sceneIndex: number,
  direction: string,
): Promise<Job> {
  return proxyMutate<Job>(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/scenes/${sceneIndex}/reroll`,
    "POST",
    { direction },
  );
}

/** Re-synthesize the whole voiceover with a different voice and re-run
 *  assembly. Returns the new revision job (202). Same 409 semantics as
 *  rerollScene. */
export function revoiceJob(jobId: string, voice: string): Promise<Job> {
  return proxyMutate<Job>(`/api/v1/jobs/${encodeURIComponent(jobId)}/revoice`, "POST", {
    voice,
  });
}

// --- Plan-first storyboard (queue job detail, "planned" status) --------
// Mirrors JobPlan/ScenePlanView/PlanUpdateBody in backend/routes/jobs.py.

export interface ScenePlan {
  index: number;
  narration: string;
  visual_prompt: string;
  motion_prompt: string;
  duration_sec: number;
}

export interface JobPlan {
  job_id: string;
  status: string;
  hook: string;
  topic: string;
  voice: string;
  scenes: ScenePlan[];
  total_duration_sec: number;
  cta: string | null;
}

export interface ScenePlanEditInput {
  index: number;
  narration: string;
  visual_prompt: string;
  motion_prompt: string;
}

/** SWR key for a job's editable storyboard. */
export function jobPlanKey(jobId: string): string {
  return `/api/v1/jobs/${encodeURIComponent(jobId)}/plan`;
}

/** Persist storyboard edits. Only valid while the job is `planned`; the
 *  full set of original scene indices must be submitted exactly once
 *  each. 409 = job isn't planned (or has no script); 422 = scene count
 *  mismatch or an empty field after trimming. */
export function updateJobPlan(
  jobId: string,
  scenes: ScenePlanEditInput[],
): Promise<JobPlan> {
  return proxyMutate<JobPlan>(jobPlanKey(jobId), "PUT", { scenes });
}

/** Continue a `planned` job into rendering using the (possibly edited)
 *  persisted script. Returns the job (202); its status flips off
 *  `planned` almost immediately as the Modal run picks it up. 409 = the
 *  job isn't `planned` (e.g. a double click already claimed it). */
export function renderJob(jobId: string): Promise<Job> {
  return proxyMutate<Job>(`/api/v1/jobs/${encodeURIComponent(jobId)}/render`, "POST");
}
