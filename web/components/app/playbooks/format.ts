// Pure helpers for playbook copy and defaults.
import type { NicheDraft } from "@/lib/actions";
import type { CreativeBrief, Niche, PostingWindow } from "@/lib/types";

export function timeLabel(w: Pick<PostingWindow, "hour" | "minute">) {
  const h12 = w.hour % 12 || 12;
  return `${h12}:${String(w.minute).padStart(2, "0")} ${w.hour < 12 ? "AM" : "PM"}`;
}

export function tzShort(tz: string) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** "Daily at 6:30 PM EST" / "Twice a day · 9:00 AM, 6:30 PM PST". */
export function cadence(windows: PostingWindow[]) {
  if (!windows.length) return "No posting window";
  const tz = tzShort(windows[0].tz);
  const times = windows.map(timeLabel).join(", ");
  if (windows.length === 1) return `Daily at ${times} ${tz}`;
  return `${windows.length === 2 ? "Twice" : `${windows.length}×`} a day · ${times} ${tz}`;
}

export const EMPTY_BRIEF: CreativeBrief = {
  hooks: { preferred_mechanisms: [], banned_openers: [], example_hooks: [] },
  narrative: { language: "", pov: "", pacing: "", reading_level: "", cta_policy: "", must_include: [], must_avoid: [] },
  visual: { camera_language: "", lighting: "", color_palette: "", negative_visuals: [] },
  audio: { music_enabled: true, music_mood: "", caption_style: { font: "Arial Black", font_size: 96, text_hex: "FFFFFF", outline_hex: "000000", uppercase: true, position: "bottom" } },
  prompt_overrides: { ideation: "", scriptwriter: "", visual_director: "", qa: "" },
};

function browserTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A blank playbook (optionally filled from a one-sentence draft) for the editor. */
export function newPlaybook(draft?: Partial<NicheDraft>): Niche {
  return {
    id: "",
    user_id: "",
    title: draft?.title ?? "",
    description: draft?.description ?? "",
    target_audience: draft?.target_audience ?? "",
    hashtags: draft?.hashtags ?? [],
    visual_style: draft?.visual_style ?? "",
    voice: draft?.voice ?? "onyx",
    target_duration_sec: draft?.target_duration_sec ?? 60,
    scene_count: draft?.scene_count ?? 6,
    image_quality: draft?.image_quality ?? "medium",
    video_resolution: draft?.video_resolution ?? "480p",
    scene_max_duration_sec: draft?.scene_max_duration_sec ?? 5,
    tts_style_directions: draft?.tts_style_directions || null,
    character_description: draft?.character_description || null,
    creative_brief: EMPTY_BRIEF,
    video_provider: "grok",
    fal_model: "",
    script_model: "",
    voice_provider: "openai",
    elevenlabs_voice_id: "",
    music_provider: "auto",
    design_kit_id: null,
    writing_kit_id: null,
    posting_windows: [{ hour: 9, minute: 0, tz: typeof window === "undefined" ? "UTC" : browserTz() }],
    platforms: [],
    daily_spend_cap_usd: "5.00",
    approve_before_post: true,
    created_at: "",
    archived_at: null,
  };
}
