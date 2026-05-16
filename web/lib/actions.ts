"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { api } from "./api";
import type { Job, Niche, Platform } from "./types";

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

export async function createNicheAction(formData: FormData): Promise<void> {
  const platforms = (formData.getAll("platforms") as string[]) as Platform[];
  if (platforms.length === 0) throw new Error("pick at least one platform");

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

  await api<Niche>("/api/v1/niches", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function enqueueJobAction(formData: FormData): Promise<void> {
  const niche_id = String(formData.get("niche_id"));
  const platform = String(formData.get("platform")) as Platform;
  if (!niche_id || !platform) throw new Error("niche_id and platform required");
  await api<Job>("/api/v1/jobs", {
    method: "POST",
    body: JSON.stringify({ niche_id, platform }),
  });
  revalidatePath("/queue");
  revalidatePath("/dashboard");
}

export async function retryJobAction(formData: FormData): Promise<void> {
  const job_id = String(formData.get("job_id"));
  if (!job_id) throw new Error("job_id required");
  await api<Job>(`/api/v1/jobs/${job_id}/retry`, { method: "POST" });
  revalidatePath("/queue");
}
