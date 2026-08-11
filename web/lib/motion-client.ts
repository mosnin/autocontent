// Client-safe typed client for the Motion Graphics API (/api/v1/motion). SWR
// keys are plain backend paths (clientFetch prefixes /api/proxy); mutations
// POST through the proxy so the Clerk JWT is attached server-side — `auth()`
// can't run in the browser. No server-only imports.
//
// Types mirror backend/routes/motion.py, src/marketer/motion/styles.py
// (catalog()), motion/beats.py (Beat.as_dict), motion/broll.py
// (BrollShot.as_dict) and motion/overlays.py (OverlaySpec.as_dict) field for
// field, plus the `motion_projects` row from migration 0033.

import { clientFetch } from "@/lib/client-fetcher";

const MOTION = "/api/v1/motion";

// ------------------------------------------------------------ style catalog

/** The half of a style a picker can render without paying for a frame. */
export interface MotionStylePreview {
  type_preview: string;
  font: string;
  uppercase: boolean;
  position: string;
  animation: string;
  /** Hex WITHOUT a leading '#' — these are ffmpeg drawtext colors. */
  text_hex: string;
  outline_hex: string;
  /** A ready-to-use CSS gradient string. */
  swatch: string;
  overlay_mode: string;
}

export interface MotionStyle {
  key: string;
  label: string;
  description: string;
  preview: MotionStylePreview;
  palette: string;
  finish: string;
}

// ---------------------------------------------------------------- projects

export type MotionAspect = "9:16" | "16:9" | "1:1";
export const MOTION_ASPECTS: MotionAspect[] = ["9:16", "16:9", "1:1"];

export type MotionSource = "generated" | "stock" | "mixed";
export const MOTION_SOURCES: MotionSource[] = ["generated", "stock", "mixed"];

export const MOTION_SOURCE_LABEL: Record<MotionSource, string> = {
  generated: "Generated",
  stock: "Stock footage",
  mixed: "Mixed",
};

export const MOTION_SOURCE_HINT: Record<MotionSource, string> = {
  generated: "Every beat gets an art-directed keyframe in the chosen style.",
  stock: "Every beat is searched for real footage; misses fall back to generated.",
  mixed: "Concrete beats use stock, abstract beats are generated.",
};

export type MotionStatus =
  | "queued"
  | "voicing"
  | "transcribing"
  | "planning"
  | "rendering"
  | "compositing"
  | "done"
  | "failed";

/** repos/motion_projects.PENDING_STATUSES, in run order. */
export const MOTION_STAGES: MotionStatus[] = [
  "queued",
  "voicing",
  "transcribing",
  "planning",
  "rendering",
  "compositing",
  "done",
];

export const MOTION_STATUS_LABEL: Record<MotionStatus, string> = {
  queued: "Queued",
  voicing: "Voicing",
  transcribing: "Transcribing",
  planning: "Planning beats",
  rendering: "Rendering b-roll",
  compositing: "Compositing",
  done: "Done",
  failed: "Failed",
};

export const MOTION_TERMINAL: ReadonlySet<MotionStatus> = new Set<MotionStatus>([
  "done",
  "failed",
]);

export function isMotionTerminal(p: { status: MotionStatus }): boolean {
  return MOTION_TERMINAL.has(p.status);
}

/** One beat's picture plan: which strategy supplied it and what it used. */
export interface MotionBroll {
  beat_index: number;
  start: number;
  end: number;
  duration: number;
  /** 'generated' | 'stock' — what actually happened, which can differ from
   *  the project's requested `source` when a stock lookup missed. */
  sourcing: string;
  camera_move: string;
  /** The art-directed keyframe prompt (generated beats). */
  prompt: string;
  /** The raw LLM search term (stock beats). */
  keyword: string;
  /** The keyword after the style bias — what was actually searched. */
  stock_query: string;
  stock_url: string | null;
  status: string;
  error: string | null;
  /** e.g. "covered", "stock_fallback:no keyword" — the fallback audit trail. */
  tags: string[];
}

export interface MotionBeat {
  index: number;
  start: number;
  end: number;
  duration: number;
  text: string;
  /** null until the planning stage has run for this beat. */
  broll: MotionBroll | null;
}

/** One line of kinetic text on screen for one time window. */
export interface MotionOverlay {
  text: string;
  start: number;
  end: number;
  animation: string;
  position: string;
  line: number;
  line_count: number;
  beat_index: number;
}

/** The `motion_projects` row. */
export interface MotionProject {
  id: string;
  user_id: string;
  niche_id: string;
  job_id: string | null;
  narration: string;
  style_key: string;
  aspect: MotionAspect;
  source: MotionSource;
  status: MotionStatus;
  beats: MotionBeat[];
  overlays: MotionOverlay[];
  video_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MotionProjectCreate {
  niche_id: string;
  /** Either narration (synthesize a voiceover) or job_id (reuse the
   *  voiceover + transcript that job already paid for). */
  narration?: string;
  job_id?: string | null;
  style_key: string;
  aspect: MotionAspect;
  source: MotionSource;
}

/** backend/routes/motion.MAX_NARRATION_CHARS. */
export const MAX_NARRATION_CHARS = 6000;

export const motionKeys = {
  styles: () => `${MOTION}/styles`,
  projects: (status?: string, limit = 50) =>
    `${MOTION}/projects?limit=${limit}${status ? `&status_filter=${status}` : ""}`,
  project: (id: string) => `${MOTION}/projects/${id}`,
};

export function motionVideoSrc(id: string): string {
  return `/api/proxy${MOTION}/projects/${id}/video`;
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

/** 202 + the queued row. */
export function createMotionProject(body: MotionProjectCreate): Promise<MotionProject> {
  return proxy("POST", `${MOTION}/projects`, body);
}

/** 202. Resumes a failed project — keyframes already on the volume are
 *  reused rather than re-bought. Returns `{ status: "queued" }`, not the row. */
export function retryMotionProject(id: string): Promise<{ status: string }> {
  return proxy("POST", `${MOTION}/projects/${id}/retry`);
}

export function fetchMotionProject(id: string): Promise<MotionProject> {
  return clientFetch<MotionProject>(motionKeys.project(id));
}

// ------------------------------------------------------------- presentation

/** `#RRGGBB` from the catalog's leading-'#'-less ffmpeg hex. */
export function cssHex(hex: string): string {
  const clean = (hex ?? "").replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean}` : "#ffffff";
}

/** mm:ss.s — beat timings are seconds with sub-second precision. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Total runtime implied by the beat plan (the last beat's end). */
export function beatsDuration(beats: MotionBeat[]): number {
  return beats.reduce((max, b) => Math.max(max, b.end), 0);
}

/** The stock lookups that missed and were rescued by a generated keyframe.
 *  Surfacing these is the whole point of persisting per-beat sourcing. */
export function fallbackReason(broll: MotionBroll | null): string | null {
  if (!broll) return null;
  const tag = broll.tags.find((t) => t.startsWith("stock_fallback:"));
  return tag ? tag.slice("stock_fallback:".length) : null;
}
