// Client-safe typed client for the Micro-Drama API (/api/v1/dramas). SWR keys
// are plain backend paths (clientFetch prefixes /api/proxy); mutations POST
// through the proxy so the Clerk JWT is attached server-side — `auth()` can't
// run in the browser. No server-only imports.
//
// Types mirror backend/routes/dramas.py (DramaDetail / CharacterView /
// ShotView) and src/marketer/drama/schemas.py field for field.

import { clientFetch } from "@/lib/client-fetcher";

const DRAMAS = "/api/v1/dramas";

// Bounds come from drama/schemas.py — the API enforces them, so the form
// must not offer anything outside them.
export const MIN_SHOTS = 2;
export const MAX_SHOTS = 12;
export const DEFAULT_SHOTS = 6;
export const MAX_CAST = 5;

export type DramaAspect = "9:16" | "16:9" | "1:1";

export const DRAMA_ASPECTS: DramaAspect[] = ["9:16", "16:9", "1:1"];

export type DramaStatus =
  | "queued"
  | "screenwriting"
  | "casting"
  | "storyboarding"
  | "rendering"
  | "editing"
  | "done"
  | "failed";

/** The pipeline stages, in the order a run walks them. Drives the progress
 *  rail on the detail page. */
export const DRAMA_STAGES: DramaStatus[] = [
  "queued",
  "screenwriting",
  "casting",
  "storyboarding",
  "rendering",
  "editing",
  "done",
];

export const DRAMA_STATUS_LABEL: Record<DramaStatus, string> = {
  queued: "Queued",
  screenwriting: "Screenwriting",
  casting: "Casting",
  storyboarding: "Storyboarding",
  rendering: "Rendering shots",
  editing: "Editing",
  done: "Done",
  failed: "Failed",
};

export const DRAMA_TERMINAL: ReadonlySet<DramaStatus> = new Set<DramaStatus>([
  "done",
  "failed",
]);

export function isDramaTerminal(d: { status: DramaStatus }): boolean {
  return DRAMA_TERMINAL.has(d.status);
}

export interface DramaCharacter {
  id: string;
  name: string;
  role: string;
  static_features: string;
  wardrobe: string;
  reference_image_path: string | null;
}

export interface DramaShotPlan {
  index: number;
  slugline: string;
  action: string;
  dialogue: string;
  character_ids: string[];
  visual_prompt: string;
  motion_prompt: string;
  duration_sec: number;
  keyframe_path: string | null;
  clip_path: string | null;
}

export interface Screenplay {
  title: string;
  logline: string;
  beats: string[];
  /** 'idea' = written by the screenwriter agent; 'script' = supplied by the
   *  caller, which skips (and never re-buys) that stage. */
  source: "idea" | "script";
  script_text: string;
}

export interface DramaPlan {
  screenplay: Screenplay | null;
  cast: DramaCharacter[];
  shots: DramaShotPlan[];
  voiceover_path: string | null;
}

/** The `micro_dramas` row. */
export interface Drama {
  id: string;
  user_id: string;
  niche_id: string;
  status: DramaStatus;
  idea: string;
  script: string;
  shot_count: number;
  aspect: DramaAspect;
  plan: DramaPlan;
  video_path: string | null;
  duration_sec: number | null;
  error: string | null;
  created_at: string;
  updated_at: string | null;
}

/** CharacterView — the portrait is availability, not just intent: the route
 *  stats the file so a swept artifact never renders a broken <img>. */
export interface CastMember {
  id: string;
  name: string;
  role: string;
  static_features: string;
  wardrobe: string;
  has_reference_image: boolean;
}

export type ShotStatus = "pending" | "framed" | "rendered";

export interface DramaShot {
  index: number;
  status: ShotStatus;
  slugline: string;
  action: string;
  dialogue: string;
  character_ids: string[];
  visual_prompt: string;
  motion_prompt: string;
  duration_sec: number;
  has_keyframe: boolean;
  has_clip: boolean;
}

export interface DramaDetail {
  drama: Drama;
  screenplay: Screenplay | null;
  cast: CastMember[];
  shots: DramaShot[];
  has_video: boolean;
}

export interface DramaCreate {
  niche_id: string;
  /** Exactly one of idea / script is required; a supplied script skips the
   *  screenwriter stage (and its spend) entirely. */
  idea?: string;
  script?: string | null;
  shot_count?: number;
  aspect?: DramaAspect;
}

export const dramaKeys = {
  list: (status?: string, limit = 50) =>
    `${DRAMAS}?limit=${limit}${status ? `&status_filter=${status}` : ""}`,
  detail: (id: string) => `${DRAMAS}/${id}`,
};

/** Browser-facing media URLs — both stream through the JWT-attaching proxy. */
export function dramaVideoSrc(id: string): string {
  return `/api/proxy${DRAMAS}/${id}/video`;
}

export function characterImageSrc(dramaId: string, characterId: string): string {
  return `/api/proxy${DRAMAS}/${dramaId}/characters/${encodeURIComponent(characterId)}/image`;
}

async function proxy<T>(method: "POST", path: string, body?: unknown): Promise<T> {
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

/** 202 + the queued row whose status then progresses. */
export function createDrama(body: DramaCreate): Promise<Drama> {
  return proxy("POST", DRAMAS, body);
}

/** 202. Resumes a failed run — the plan (screenplay, locked portraits,
 *  already-rendered shots) is inherited rather than re-bought. */
export function retryDrama(id: string): Promise<Drama> {
  return proxy("POST", `${DRAMAS}/${id}/retry`);
}

export function fetchDrama(id: string): Promise<DramaDetail> {
  return clientFetch<DramaDetail>(dramaKeys.detail(id));
}
