// Client-safe typed client for the Studio API (/api/v1/studio). The browser
// never holds a provider key and never calls a generation vendor: it submits
// here and polls. SWR keys are plain backend paths (clientFetch prefixes
// /api/proxy); mutations go through the proxy so the Clerk JWT is attached
// server-side.

import { clientFetch } from "@/lib/client-fetcher";

const STUDIO = "/api/v1/studio";

/** Model classes the server can run. Studio surfaces map onto these. */
export type StudioKind =
  | "image"
  | "video"
  | "audio"
  | "lipsync"
  | "video2video"
  | "recast";

export type StudioStatus = "queued" | "running" | "done" | "failed";

/** A model with a configured provider path — the only ones the picker offers. */
export interface StudioModel {
  id: string;
  name: string;
  kind: StudioKind;
  /** Entry in the local model catalog whose `inputs` schema drives controls. */
  catalog_id: string | null;
  provider: string;
  output_kind: "image" | "video" | "audio";
  unit: string;
  usd_per_unit: string;
  required_params: string[];
  allowed_durations: number[];
  default_duration_sec: number;
  max_duration_sec: number;
  duration_from_input: boolean;
}

export interface StudioOutput {
  url: string;
  kind?: string;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
  bytes?: number | null;
  asset_id?: string | null;
}

export interface StudioGeneration {
  id: string;
  user_id: string;
  kind: StudioKind;
  model: string;
  params: Record<string, unknown>;
  status: StudioStatus;
  provider: string | null;
  provider_request_id: string | null;
  outputs: StudioOutput[];
  error: string | null;
  cost_usd: string;
  created_at: string;
  updated_at: string;
}

export interface GenerationPage {
  items: StudioGeneration[];
  next_cursor: string | null;
}

export interface StudioUpload {
  url: string;
  key: string;
  content_type: string;
  bytes: number;
}

export const studioKeys = {
  models: (kind?: StudioKind) => `${STUDIO}/models${kind ? `?kind=${kind}` : ""}`,
  generations: (kind?: StudioKind, limit = 30, cursor?: string) => {
    const q = new URLSearchParams();
    if (kind) q.set("kind", kind);
    q.set("limit", String(limit));
    if (cursor) q.set("cursor", cursor);
    return `${STUDIO}/generations?${q.toString()}`;
  },
  generation: (id: string) => `${STUDIO}/generations/${id}`,
};

export class StudioError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function proxy<T>(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    cache: "no-store",
  });
  if (!res.ok) throw new StudioError(res.status, await readError(res));
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json")
    ? ((await res.json()) as T)
    : (undefined as T);
}

/** FastAPI puts the human-readable reason in `detail`; fall back to raw text. */
async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    /* not JSON — use the raw body */
  }
  return text || `${res.status}`;
}

export function listModels(kind?: StudioKind): Promise<StudioModel[]> {
  return clientFetch<StudioModel[]>(studioKeys.models(kind));
}

export function getGeneration(id: string): Promise<StudioGeneration> {
  return clientFetch<StudioGeneration>(studioKeys.generation(id));
}

/**
 * Submit a generation. Rejects with a `StudioError` carrying the server's
 * reason: 402 when a spend cap or credit balance refuses it, 422 for bad
 * params or an unsafe input URL, 503 when the provider isn't configured.
 */
export function createGeneration(input: {
  kind: StudioKind;
  model: string;
  params: Record<string, unknown>;
}): Promise<StudioGeneration> {
  return proxy<StudioGeneration>("POST", `${STUDIO}/generations`, input);
}

export function deleteGeneration(id: string): Promise<void> {
  return proxy<void>("DELETE", `${STUDIO}/generations/${id}`);
}

/** Store a reference image/video/audio and get back a URL the models accept. */
export async function uploadReference(file: File): Promise<StudioUpload> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/proxy${STUDIO}/uploads`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!res.ok) throw new StudioError(res.status, await readError(res));
  return (await res.json()) as StudioUpload;
}
