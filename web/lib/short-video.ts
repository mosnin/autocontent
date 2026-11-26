// Short video (docs/short-video.md): types mirroring backend/routes/short_videos.py
// and the pure helpers the create flow and batch list use. No React, no aliases:
// test/short-video.test.ts runs this file directly.

export type Aspect = "9:16" | "16:9" | "1:1";
export type FootageSource = "pexels" | "pixabay" | "uploads";
export type Transition = "none" | "fade" | "fade_in" | "fade_out" | "shuffle";
export type CaptionMode = "sentence" | "word" | "highlight";
export type MusicMode = "none" | "library" | "generated";

export interface ShortVideoSettings {
  look: { aspect: Aspect; duration_sec: number; voice_provider: "openai" | "elevenlabs"; voice: string; language: string; tone: string };
  footage: { sources: FootageSource[]; upload_ids: string[]; clip_duration_sec: number; speed: number; transition: Transition; fit: "crop" | "letterbox"; order: "random" | "sequential" };
  subtitles: {
    enabled: boolean;
    mode: CaptionMode;
    delivery: "burned" | "sidecar" | "both";
    font: string;
    font_size: number;
    position: "bottom" | "center" | "top";
    text_hex: string;
    highlight_hex: string;
    outline_hex: string;
    outline_px: number;
    uppercase: boolean;
    max_chars: number;
  };
  music: { mode: MusicMode; mood: string; volume_db: number; duck: boolean };
}

export const DEFAULT_SETTINGS: ShortVideoSettings = {
  look: { aspect: "9:16", duration_sec: 30, voice_provider: "openai", voice: "onyx", language: "en", tone: "" },
  footage: { sources: ["pexels", "pixabay"], upload_ids: [], clip_duration_sec: 4, speed: 1, transition: "fade", fit: "crop", order: "random" },
  subtitles: { enabled: true, mode: "highlight", delivery: "burned", font: "Arial Black", font_size: 84, position: "bottom", text_hex: "FFFFFF", highlight_hex: "FFD400", outline_hex: "000000", outline_px: 5, uppercase: false, max_chars: 22 },
  music: { mode: "library", mood: "", volume_db: -18, duck: true },
};

export interface StockClip {
  provider: "pexels" | "pixabay" | "upload";
  provider_id: string;
  kind: "video" | "image";
  page_url: string;
  creator: string;
  creator_url: string;
  licence: string;
  licence_url: string;
  query: string;
}

export type StageName = "script" | "voice" | "timing" | "footage" | "edit" | "subtitles" | "music" | "render";
export const STAGES: { id: StageName; label: string }[] = [
  { id: "script", label: "Script" },
  { id: "voice", label: "Voiceover" },
  { id: "timing", label: "Timing" },
  { id: "footage", label: "Footage" },
  { id: "edit", label: "Edit" },
  { id: "subtitles", label: "Subtitles" },
  { id: "music", label: "Music" },
  { id: "render", label: "Render" },
];

export interface StageState {
  state: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
}

export interface ShortVideoItem {
  id: string;
  variant: number;
  attempt: number;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string;
  progress: number;
  stages: Partial<Record<StageName, StageState>>;
  hook: string;
  clips: StockClip[];
  video_path: string | null;
  srt_path: string | null;
  vtt_path: string | null;
  duration_sec: string | number | null;
  spent_micros: number;
  error: string | null;
}

export type BatchStatus = "awaiting_approval" | "queued" | "running" | "done" | "partial" | "failed" | "cancelled";

export interface ShortVideoBatch {
  id: string;
  title: string;
  source: "topic" | "script";
  topic: string;
  settings: ShortVideoSettings;
  variants: number;
  status: BatchStatus;
  estimate_micros: number;
  cap_micros: number;
  spent_micros: number;
  error: string | null;
  created_at: string | null;
  items: ShortVideoItem[];
}

export interface Estimate {
  per_variant_usd: string;
  total_usd: string;
  cap_usd: string;
  needs_approval: boolean;
  lines: Record<string, string>;
}

export interface Options {
  defaults: ShortVideoSettings;
  voices: { openai: string[]; elevenlabs: string[] };
  footage_sources: FootageSource[];
  music_modes: MusicMode[];
  limits: { max_variants: number; approval_variants: number; upload_types: string[] };
}

export interface Upload {
  id: string;
  kind: "video" | "image";
  filename: string;
  status: "pending" | "ready" | "rejected";
  error: string | null;
}

/** The create flow: one decision per step. */
export const STEPS = [
  { id: "idea", label: "Topic or script" },
  { id: "look", label: "Look & voice" },
  { id: "footage", label: "Footage" },
  { id: "finish", label: "Subtitles & music" },
  { id: "variants", label: "Variants" },
  { id: "render", label: "Render" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export interface Draft {
  source: "topic" | "script";
  topic: string;
  script: string;
  variants: number;
  settings: ShortVideoSettings;
}

export const EMPTY_DRAFT: Draft = { source: "topic", topic: "", script: "", variants: 1, settings: DEFAULT_SETTINGS };

export function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/** Why the idea step can't continue yet, or null. Mirrors the backend's request validation. */
export function ideaProblem(d: Pick<Draft, "source" | "topic" | "script">): string | null {
  if (d.source === "topic") return d.topic.trim().length >= 3 ? null : "Write a topic, a few words is enough.";
  return wordCount(d.script) >= 5 ? null : "Paste a script of at least five words.";
}

/** The request body for POST /short-videos and /estimate. */
export function toRequest(d: Draft, nicheId?: string | null) {
  return {
    source: d.source,
    topic: d.topic.trim(),
    script: d.source === "script" ? d.script.trim() : "",
    variants: Math.max(1, Math.min(10, Math.round(d.variants))),
    ...(nicheId ? { niche_id: nicheId } : {}),
    settings: d.settings,
  };
}

/** Patch one group of settings immutably. */
export function patch<K extends keyof ShortVideoSettings>(s: ShortVideoSettings, group: K, change: Partial<ShortVideoSettings[K]>): ShortVideoSettings {
  return { ...s, [group]: { ...s[group], ...change } };
}

/** Settings that differ from the defaults, as short phrases for the summary line. */
export function changedFromDefaults(s: ShortVideoSettings): string[] {
  const d = DEFAULT_SETTINGS;
  const out: string[] = [];
  if (s.footage.clip_duration_sec !== d.footage.clip_duration_sec) out.push(`${s.footage.clip_duration_sec}s clips`);
  if (s.footage.speed !== d.footage.speed) out.push(`${s.footage.speed}× speed`);
  if (s.footage.transition !== d.footage.transition) out.push(s.footage.transition === "none" ? "hard cuts" : s.footage.transition.replace("_", " "));
  if (s.footage.fit !== d.footage.fit) out.push(s.footage.fit === "letterbox" ? "letterbox" : "crop to fill");
  if (s.footage.order !== d.footage.order) out.push(`${s.footage.order} order`);
  if (s.subtitles.font !== d.subtitles.font || s.subtitles.font_size !== d.subtitles.font_size) out.push(`${s.subtitles.font} ${s.subtitles.font_size}`);
  if (s.subtitles.delivery !== d.subtitles.delivery) out.push(s.subtitles.delivery === "sidecar" ? "subtitle files only" : "burned in + files");
  if (s.music.volume_db !== d.music.volume_db) out.push(`music ${s.music.volume_db} dB`);
  if (s.music.duck !== d.music.duck) out.push(s.music.duck ? "ducking" : "no ducking");
  if (s.look.tone) out.push(`tone: ${s.look.tone}`);
  return out;
}

/** One quiet line describing the whole draft, shown on the render step. */
export function summary(d: Draft): string {
  const s = d.settings;
  const footage = s.footage.sources.includes("uploads") && s.footage.sources.length === 1 ? "your uploads" : s.footage.sources.includes("uploads") ? "stock and your uploads" : "stock footage";
  const subs = s.subtitles.enabled ? `${s.subtitles.mode === "highlight" ? "highlighted" : s.subtitles.mode === "word" ? "word-by-word" : "line"} subtitles` : "no subtitles";
  const music = s.music.mode === "none" ? "no music" : s.music.mode === "generated" ? "an original score" : "library music";
  const variants = d.variants === 1 ? "1 video" : `${d.variants} variants`;
  return `${variants} · ${s.look.aspect} · about ${s.look.duration_sec}s · ${footage} · ${subs} · ${music}`;
}

export function needsApproval(variants: number, totalUsd: number, approvalVariants = 3): boolean {
  return variants > approvalVariants || totalUsd > 5;
}

export function usdFromMicros(micros: number): string {
  const v = micros / 1_000_000;
  return v < 0.01 && v > 0 ? "<$0.01" : `$${v.toFixed(2)}`;
}

/** Where a variant stands, for its row. */
export function itemProgress(item: Pick<ShortVideoItem, "status" | "stage" | "stages">): { current: number; complete: boolean; failed: boolean } {
  if (item.status === "done") return { current: STAGES.length, complete: true, failed: false };
  const idx = STAGES.findIndex((s) => s.id === item.stage);
  const failedIdx = STAGES.findIndex((s) => item.stages[s.id]?.state === "failed");
  if (item.status === "failed") return { current: failedIdx >= 0 ? failedIdx : Math.max(idx, 0), complete: false, failed: true };
  return { current: Math.max(idx, 0), complete: false, failed: false };
}

export function batchTone(status: BatchStatus): "neutral" | "positive" | "negative" | "attention" | "accent" {
  if (status === "done") return "positive";
  if (status === "failed") return "negative";
  if (status === "awaiting_approval" || status === "partial") return "attention";
  if (status === "running" || status === "queued") return "accent";
  return "neutral";
}

export function batchLabel(status: BatchStatus): string {
  return { awaiting_approval: "Needs approval", queued: "Queued", running: "Making", done: "Ready", partial: "Partly ready", failed: "Failed", cancelled: "Cancelled" }[status];
}

/** Unique credits for a variant's footage, "Video by Ana Lima on Pexels". */
export function credits(clips: StockClip[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of clips) {
    if (c.provider === "upload") continue;
    const line = `${c.creator || "Unknown creator"} on ${c.provider === "pexels" ? "Pexels" : "Pixabay"}`;
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

export const isLive = (b: Pick<ShortVideoBatch, "status">) => b.status === "queued" || b.status === "running";
