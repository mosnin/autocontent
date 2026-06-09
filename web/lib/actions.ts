"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { api } from "./api";
import type { ActionState } from "./action-state";
import type {
  AyrshareConnectResponse,
  Job,
  Niche,
  Platform,
  TokenCreateResponse,
  User,
} from "./types";

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

export async function updateNicheAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const niche_id = String(formData.get("niche_id") || "").trim();
  if (!niche_id) return { ok: false, error: "niche_id required" };

  const platforms = (formData.getAll("platforms") as string[]) as Platform[];
  if (platforms.length === 0) {
    return { ok: false, error: "pick at least one platform" };
  }

  const postingHour = Number(formData.get("posting_hour"));
  const postingMinute = Number(formData.get("posting_minute"));
  const tz = String(formData.get("tz") || "America/Los_Angeles");
  const ttsStyleRaw = String(formData.get("tts_style_directions") || "").trim();

  // Send the full payload (all fields optional on the backend), keeps
  // semantics symmetric with createNicheAction.
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
    image_quality:
      (formData.get("image_quality") as "low" | "medium" | "high") || "medium",
    video_resolution:
      (formData.get("video_resolution") as "480p" | "720p") || "480p",
    scene_max_duration_sec: Number(formData.get("scene_max_duration_sec") || 5),
    tts_style_directions: ttsStyleRaw ? ttsStyleRaw : null,
  };

  try {
    await api<Niche>(`/api/v1/niches/${niche_id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/niches/${niche_id}/edit`);
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

export async function createTokenAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") || "").trim();
  if (!name) return { ok: false, error: "name required" };
  const expRaw = String(formData.get("expires_in_days") || "").trim();
  const body: Record<string, unknown> = { name };
  if (expRaw) {
    const n = Number(expRaw);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "expires_in_days must be > 0" };
    body.expires_in_days = n;
  }
  let plaintext: string;
  try {
    const res = await api<TokenCreateResponse>("/api/v1/tokens", {
      method: "POST",
      body: JSON.stringify(body),
    });
    plaintext = res.token;
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  revalidatePath("/settings/tokens");
  // The plaintext is shown exactly once via the query param. We could
  // use cookies but they leak via cache; the URL is fine for a short hop.
  redirect(`/settings/tokens?just_created=${encodeURIComponent(plaintext)}`);
}

export async function revokeTokenAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token_id = String(formData.get("token_id"));
  if (!token_id) return { ok: false, error: "token_id required" };
  try {
    await api(`/api/v1/tokens/${token_id}`, { method: "DELETE" });
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  revalidatePath("/settings/tokens");
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

export async function updateUserSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rawCap = String(formData.get("global_daily_cap_usd") || "").trim();
  const global_daily_cap_usd = rawCap === "" ? null : rawCap;

  try {
    await api<User>("/api/v1/users/me", {
      method: "PATCH",
      body: JSON.stringify({ global_daily_cap_usd }),
    });
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }

  revalidatePath("/settings");
  return { ok: true };
}
