// Pure FormData -> niche payload for the playbook editor (create + update).
// Mirrors the private builders in lib/actions.ts (createNicheAction /
// updateNicheAction) so the payload shape stays identical; kept separate
// because lib/actions.ts can only export async server actions.

import type { CreativeBrief, Platform } from "./types";

export interface PlaybookPayload {
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
  character_description: string | null;
  approve_before_post: boolean;
  creative_brief?: CreativeBrief;
  video_provider?: "grok" | "fal";
  fal_model?: string;
  script_model?: string;
  voice_provider?: "openai" | "elevenlabs";
  elevenlabs_voice_id?: string;
  music_provider?: "auto" | "library" | "generated";
  design_kit_id?: string | null;
  writing_kit_id?: string | null;
}

const splitCsv = (raw: string | null) =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^#/, ""))
    .filter(Boolean);

function providerFields(fd: FormData): Partial<PlaybookPayload> {
  if (fd.get("providers_present") !== "1") return {};
  const [provider, ...rest] = String(fd.get("video_model_choice") || "grok:").split(":");
  const voice = String(fd.get("voice_provider") || "openai");
  const music = String(fd.get("music_provider") || "auto");
  return {
    video_provider: provider === "fal" ? "fal" : "grok",
    fal_model: provider === "fal" ? rest.join(":") : "",
    script_model: String(fd.get("script_model") || ""),
    voice_provider: voice === "elevenlabs" ? "elevenlabs" : "openai",
    elevenlabs_voice_id: String(fd.get("elevenlabs_voice_id") || "").trim(),
    music_provider: music === "library" || music === "generated" ? music : "auto",
    design_kit_id: String(fd.get("design_kit_id") || "") || null,
    writing_kit_id: String(fd.get("writing_kit_id") || "") || null,
  };
}

function brief(fd: FormData): CreativeBrief | undefined {
  if (fd.get("brief_present") !== "1") return undefined;
  const get = (k: string) => String(fd.get(k) || "").trim();
  const lines = (k: string) =>
    get(k)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const hex = (k: string, fallback: string) => {
    const v = get(k).replace(/^#/, "");
    return /^[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : fallback;
  };
  const pos = get("brief_caption_position");
  return {
    hooks: {
      preferred_mechanisms: fd.getAll("brief_mechanisms").map(String),
      banned_openers: splitCsv(get("brief_banned_openers")),
      example_hooks: lines("brief_example_hooks").slice(0, 10),
    },
    narrative: {
      language: get("brief_language"),
      pov: get("brief_pov"),
      pacing: get("brief_pacing"),
      reading_level: get("brief_reading_level"),
      cta_policy: get("brief_cta_policy"),
      must_include: splitCsv(get("brief_must_include")),
      must_avoid: splitCsv(get("brief_must_avoid")),
    },
    visual: {
      camera_language: get("brief_camera_language"),
      lighting: get("brief_lighting"),
      color_palette: get("brief_color_palette"),
      negative_visuals: splitCsv(get("brief_negative_visuals")),
    },
    audio: {
      music_enabled: fd.get("brief_music_enabled") === "on",
      music_mood: get("brief_music_mood"),
      caption_style: {
        font: get("brief_caption_font") || "Arial Black",
        font_size: Number(get("brief_caption_size") || 96),
        text_hex: hex("brief_caption_text_hex", "FFFFFF"),
        outline_hex: hex("brief_caption_outline_hex", "000000"),
        uppercase: fd.get("brief_caption_uppercase") === "on",
        position: pos === "center" || pos === "top" ? pos : "bottom",
      },
    },
    prompt_overrides: {
      ideation: get("brief_extra_ideation"),
      scriptwriter: get("brief_extra_script"),
      visual_director: get("brief_extra_visual"),
      qa: get("brief_extra_qa"),
    },
  };
}

/** Posting windows: repeated "pw" fields ("HH:MM") with one "tz", or the legacy posting_hour/posting_minute pair. */
function windows(fd: FormData): { hour: number; minute: number; tz: string }[] {
  const tz = String(fd.get("tz") || "America/Los_Angeles").trim() || "UTC";
  const times = fd
    .getAll("pw")
    .map(String)
    .map((t) => /^(\d{1,2}):(\d{2})/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])), tz }));
  if (times.length > 0) return times;
  return [{ hour: Number(fd.get("posting_hour") || 9), minute: Number(fd.get("posting_minute") || 0), tz }];
}

export function playbookPayload(fd: FormData): { ok: true; payload: PlaybookPayload } | { ok: false; error: string } {
  const platforms = fd.getAll("platforms").map(String) as Platform[];
  if (platforms.length === 0) return { ok: false, error: "Pick at least one platform." };
  const title = String(fd.get("title") || "").trim();
  if (!title) return { ok: false, error: "Give the playbook a name." };
  const tts = String(fd.get("tts_style_directions") || "").trim();
  const character = String(fd.get("character_description") || "").trim();
  const iq = String(fd.get("image_quality") || "medium");
  return {
    ok: true,
    payload: {
      title,
      description: String(fd.get("description") || "").trim(),
      target_audience: String(fd.get("target_audience") || "").trim(),
      hashtags: splitCsv(String(fd.get("hashtags") || "")),
      visual_style: String(fd.get("visual_style") || "").trim(),
      voice: String(fd.get("voice") || "onyx"),
      target_duration_sec: Number(fd.get("target_duration_sec") || 60),
      scene_count: Number(fd.get("scene_count") || 6),
      posting_windows: windows(fd),
      platforms,
      daily_spend_cap_usd: String(fd.get("daily_spend_cap_usd") || "5.00"),
      image_quality: iq === "low" || iq === "high" ? iq : "medium",
      video_resolution: fd.get("video_resolution") === "720p" ? "720p" : "480p",
      scene_max_duration_sec: Number(fd.get("scene_max_duration_sec") || 5),
      tts_style_directions: tts || null,
      character_description: character || null,
      creative_brief: brief(fd),
      ...providerFields(fd),
      approve_before_post: fd.get("approve_before_post") === "on",
    },
  };
}
