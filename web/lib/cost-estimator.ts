// Pure cost estimation used by the onboarding wizard and run-confirm
// dialog. Numbers come from the public OpenAI / xAI rate cards in
// effect at the time the niche is created; they are intentionally
// duplicated client-side so the UI can show a live preview without a
// round trip.

export interface EstimateInput {
  scene_count: number;
  image_quality: "low" | "medium" | "high";
  video_resolution: "480p" | "720p";
  scene_max_duration_sec: number;
  target_duration_sec: number;
}

export interface CostBreakdown {
  image: number;
  video: number;
  tts: number;
  whisper: number;
  character_sheet: number;
  total: number;
}

// Portrait 1024x1536 tier — what the pipeline actually renders for 9:16.
// (The square tier is ~1.5x cheaper; quoting it here would understate every
// estimate the user sees.)
const IMAGE_RATE: Record<"low" | "medium" | "high", number> = {
  low: 0.016,
  medium: 0.063,
  high: 0.25,
};

// Per-second rate for Grok Imagine output. Both 480p and 720p price
// the same on the public list; resolution is accepted for parity with
// the backend payload shape.
const VIDEO_PER_SEC = 0.05;
const TTS_PER_MIN = 0.015;
const WHISPER_PER_MIN = 0.006;

export function estimateVideoCostUsd(input: EstimateInput): CostBreakdown {
  const sceneCount = Math.max(0, input.scene_count);
  const sceneDur = Math.max(0, input.scene_max_duration_sec);
  const targetDur = Math.max(0, input.target_duration_sec);

  const image = sceneCount * IMAGE_RATE[input.image_quality];
  const video = sceneCount * sceneDur * VIDEO_PER_SEC;
  const tts = (targetDur / 60) * TTS_PER_MIN;
  const whisper = (targetDur / 60) * WHISPER_PER_MIN;
  // Character sheet is a single image at the selected quality. We
  // include it in every per-run estimate because the user thinks in
  // "what does it cost to produce one video?" - the backend amortizes
  // it across the lifetime of the niche.
  const character_sheet = IMAGE_RATE[input.image_quality];

  const total = image + video + tts + whisper + character_sheet;

  return { image, video, tts, whisper, character_sheet, total };
}
