// Client-safe typed client for the Design Agent API (/api/v1/design). SWR
// keys are plain backend paths (clientFetch prefixes /api/proxy); mutations
// POST through the proxy so the Clerk JWT is attached server-side. Step image
// URLs are already proxy-prefixed because an <img src> can't carry a bearer
// token. No server-only imports - this runs in the browser.

import { clientFetch } from "@/lib/client-fetcher";

const DESIGN = "/api/v1/design";

// ------------------------------------------------------------------- types

export type DesignFormat = "1:1" | "9:16" | "16:9";
export type DesignProjectStatus =
  | "queued"
  | "planning"
  | "executing"
  | "done"
  | "failed";
export type DesignStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** The five canvas operations the planner may emit. Kept as a union plus a
 *  string fallback: the catalog is code on the backend and may grow. */
export type DesignOperation =
  | "generate"
  | "edit"
  | "compose"
  | "upscale"
  | "text_overlay";

export const DESIGN_OPERATIONS: readonly DesignOperation[] = [
  "generate",
  "edit",
  "compose",
  "upscale",
  "text_overlay",
];

/** The typed, bounded input payload of one step. */
export interface DesignStepInputs {
  prompt: string;
  text: string;
  quality: "low" | "medium" | "high";
}

export interface DesignStep {
  index: number;
  id: string;
  operation: string;
  label: string;
  inputs: DesignStepInputs;
  depends_on: string[];
  status: DesignStepStatus;
  error: string;
  /** Content-addressed path on the volume; empty until the step runs. */
  output_path: string;
  output_digest: string;
}

/** `plan` is `{}` on a fresh row, so every field is optional. */
export interface DesignPlan {
  title?: string;
  format?: DesignFormat;
  notes?: string[];
  steps?: DesignStep[];
}

/** One produced image on the canvas, keyed back to the step that made it. */
export interface DesignCanvasObject {
  step_id: string;
  index: number;
  operation: string;
  label: string;
  path: string;
  digest: string;
  size: string;
  bytes: number;
}

export interface DesignProject {
  id: string;
  user_id: string;
  niche_id: string;
  brief: string;
  format: DesignFormat;
  max_steps: number;
  status: DesignProjectStatus;
  plan: DesignPlan;
  canvas: DesignCanvasObject[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const DESIGN_MAX_STEPS = 16;

// -------------------------------------------------------------------- keys

export const designKeys = {
  // NOTE: the backend's list param is literally `status_filter` (no alias),
  // unlike the headshots list which aliases it to `status`.
  projects: (status?: string, limit = 50) =>
    `${DESIGN}/projects?limit=${limit}${status ? `&status_filter=${status}` : ""}`,
  project: (id: string) => `${DESIGN}/projects/${id}`,
};

/** Streaming PNG for one step's output, through the proxy. `nonce` busts the
 *  browser cache after a retry re-renders the same step id. */
export function designStepImageUrl(
  projectId: string,
  stepId: string,
  nonce?: number,
): string {
  const q = nonce ? `?r=${nonce}` : "";
  return `/api/proxy${DESIGN}/projects/${projectId}/steps/${stepId}/image${q}`;
}

// --------------------------------------------------------------- lifecycle

const PROJECT_TERMINAL: ReadonlySet<DesignProjectStatus> = new Set(["done", "failed"]);

export function isProjectActive(p: Pick<DesignProject, "status">): boolean {
  return !PROJECT_TERMINAL.has(p.status);
}

export function planSteps(project: DesignProject): DesignStep[] {
  return project.plan?.steps ?? [];
}

/** Completed steps over total - the plan's own progress, not the row's. */
export function planProgress(project: DesignProject): { done: number; total: number } {
  const steps = planSteps(project);
  return { done: steps.filter((s) => s.status === "done").length, total: steps.length };
}

export function hasStepOutput(step: DesignStep): boolean {
  return step.status === "done" && Boolean(step.output_path);
}

/** Group steps into dependency layers, mirroring the executor's own Kahn
 *  pass: layer 0 depends on nothing, every step in layer N depends only on
 *  earlier layers. The executor runs a layer concurrently, so this is the
 *  shape the plan actually executes in - worth drawing rather than a flat
 *  list. A malformed graph (the backend rejects cycles before any spend)
 *  degrades to trailing leftovers instead of looping. */
export function planLayers(steps: DesignStep[]): DesignStep[][] {
  let remaining = [...steps];
  const settled = new Set<string>();
  const layers: DesignStep[][] = [];
  while (remaining.length > 0) {
    const layer = remaining.filter((s) => s.depends_on.every((d) => settled.has(d)));
    if (layer.length === 0) {
      layers.push(remaining);
      break;
    }
    layers.push(layer);
    for (const s of layer) settled.add(s.id);
    remaining = remaining.filter((s) => !settled.has(s.id));
  }
  return layers;
}

/** Aspect-ratio utility class for a project's format. */
export function formatAspectClass(format: DesignFormat): string {
  if (format === "9:16") return "aspect-[9/16]";
  if (format === "16:9") return "aspect-video";
  return "aspect-square";
}

/** A per-step retry is only claimable on a terminal project (the backend
 *  409s otherwise), so the button is hidden while a run is in flight. */
export function canRetryStep(project: DesignProject): boolean {
  return (
    (project.status === "done" || project.status === "failed") &&
    planSteps(project).length > 0
  );
}

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

/** Create a project; planning runs in the background (202 + the row). */
export function createDesignProject(body: {
  niche_id: string;
  brief: string;
  format?: DesignFormat;
  max_steps?: number;
}): Promise<DesignProject> {
  return proxy("POST", `${DESIGN}/projects`, {
    niche_id: body.niche_id,
    brief: body.brief,
    format: body.format ?? "1:1",
    max_steps: body.max_steps ?? 8,
  });
}

/** Resume a failed project - completed steps keep their outputs. */
export function retryDesignProject(id: string): Promise<{ status: string }> {
  return proxy("POST", `${DESIGN}/projects/${id}/retry`);
}

/** Re-run one step and everything downstream of it. */
export function retryDesignStep(
  id: string,
  stepId: string,
): Promise<{ status: string; from_step: string }> {
  return proxy("POST", `${DESIGN}/projects/${id}/steps/${stepId}/retry`);
}

export function fetchDesignProjects(
  status?: string,
  limit = 50,
): Promise<DesignProject[]> {
  return clientFetch<DesignProject[]>(designKeys.projects(status, limit));
}
