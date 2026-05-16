"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { api } from "./api";
import type { AyrshareConnectResponse, Job, Niche, Platform } from "./types";

export interface ActionState {
  ok: boolean;
  error?: string;
}

export const EMPTY_STATE: ActionState = { ok: false };

interface NicheCreatePayload {
  title: string;
  description: string;
  target_audience: string;
  hashtags: string[];
  visual_style: string;
  voice: string;
  target_duration_sec: number;
  scene_count: number;
  posting_windows: { hour: number; minute: number; tz: string }[];
  platforms: Platform[];
  daily_spend_cap_usd: string;
  image_quality: "low" | "medium" | "high";
  video_resolution: "480p" | "720p";
  scene_max_duration_sec: number;
  tts_style_directions: string | null;
}

function splitCsv(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export async function createNicheAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const platforms = (formData.getAll("platforms") as string[]) as Platform[];
  if (platforms.length === 0) {
    return { ok: false, error: "pick at least one platform" };
  }

  const postingHour = Number(formData.get("posting_hour"));
  const postingMinute = Number(formData.get("posting_minute"));
  const tz = String(formData.get("tz") || "America/Los_Angeles");
  const ttsStyleRaw = String(formData.get("tts_style_directions") || "").trim();

  const payload: NicheCreatePayload = {
    title: String(formData.get("title") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    target_audience: String(formData.get("target_audience") || "").trim(),
    hashtags: splitCsv(String(formData.get("hashtags") || "")),
    visual_style: String(formData.get("visual_style") || "").trim(),
    voice: String(formData.get("voice") || "onyx"),
    target_duration_sec: Number(formData.get("target_duration_sec") || 60),
    scene_count: Number(formData.get("scene_count") || 6),
    posting_windows: [{ hour: postingHour, minute: postingMinute, tz }],
    platforms,
    daily_spend_cap_usd: String(formData.get("daily_spend_cap_usd") || "5.00"),
    image_quality: (formData.get("image_quality") as "low" | "medium" | "high") || "medium",
    video_resolution: (formData.get("video_resolution") as "480p" | "720p") || "480p",
    scene_max_duration_sec: Number(formData.get("scene_max_duration_sec") || 5),
    tts_style_directions: ttsStyleRaw ? ttsStyleRaw : null,
  };

  try {
    await api<Niche>("/api/v1/niches", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function enqueueJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const niche_id = String(formData.get("niche_id"));
  const platform = String(formData.get("platform")) as Platform;
  if (!niche_id || !platform) {
    return { ok: false, error: "niche_id and platform required" };
  }
  try {
    await api<Job>("/api/v1/jobs", {
      method: "POST",
      body: JSON.stringify({ niche_id, platform }),
    });
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  revalidatePath("/queue");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function retryJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const job_id = String(formData.get("job_id"));
  if (!job_id) return { ok: false, error: "job_id required" };
  try {
    await api<Job>(`/api/v1/jobs/${job_id}/retry`, { method: "POST" });
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  revalidatePath("/queue");
  return { ok: true };
}

export async function archiveNicheAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const niche_id = String(formData.get("niche_id"));
  if (!niche_id) return { ok: false, error: "niche_id required" };
  try {
    await api<Niche>(`/api/v1/niches/${niche_id}`, { method: "DELETE" });
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function connectAyrshareAction(): Promise<void> {
  // Creates (or reuses) the user's Ayrshare profile and bounces them to
  // the hosted OAuth chooser so they can link TikTok / IG / YouTube.
  const res = await api<AyrshareConnectResponse>("/api/v1/connect/ayrshare", {
    method: "POST",
  });
  revalidatePath("/connect");
  redirect(res.login_url);
}
