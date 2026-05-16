// Pure-function video cost estimator. Used by:
//   - the onboarding wizard's live "estimated cost per video" card
//   - the run-now confirmation modal
//   - the job detail page's "Costs" tab (when we can't reconstruct the
//     exact per-call ledger from the backend)
//
// Numbers are sourced from the pricing tables wired into the backend:
//   - Image: see src/autocontent/services/openai_images (per-image)
//   - Video: Grok Imagine, per-second-of-clip
//   - TTS / Whisper: per-minute, OpenAI pricing
//
// Frontend math doesn't need Decimal precision — these are rough quotes
// to guide the user, the real ledger is authoritative.

import type { ImageQuality } from "./types";

export interface CostInputs {
  scene_count: number;
  image_quality: ImageQuality;
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

const IMAGE_COST_PER_SCENE: Record<ImageQuality, number> = {
  low: 0.011,
  medium: 0.042,
  high: 0.167,
};

const VIDEO_COST_PER_SCENE_SEC = 0.05;
const TTS_COST_PER_MIN = 0.015;
const WHISPER_COST_PER_MIN = 0.006;

export function estimateVideoCostUsd(inputs: CostInputs): CostBreakdown {
  const scenes = Math.max(0, Number(inputs.scene_count) || 0);
  const maxSec = Math.max(0, Number(inputs.scene_max_duration_sec) || 0);
  const totalSec = Math.max(0, Number(inputs.target_duration_sec) || 0);
  const perScene = IMAGE_COST_PER_SCENE[inputs.image_quality] ?? IMAGE_COST_PER_SCENE.medium;

  const image = scenes * perScene;
  const video = scenes * maxSec * VIDEO_COST_PER_SCENE_SEC;
  const tts = (totalSec / 60) * TTS_COST_PER_MIN;
  const whisper = (totalSec / 60) * WHISPER_COST_PER_MIN;
  // Character sheet is generated once per niche, not per video, but the
  // first video of a niche eats that cost. Surfaced separately so the UI
  // can label it that way.
  const character_sheet = perScene;

  const total = image + video + tts + whisper + character_sheet;
  return { image, video, tts, whisper, character_sheet, total };
}
