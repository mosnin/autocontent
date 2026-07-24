import type { StudioKind } from "@/lib/studio/client";

/**
 * The payload keys each model class accepts, mirroring the server's
 * whitelist in `studio_gen.validate_params`. The server is authoritative —
 * it rejects anything outside this set rather than silently dropping it —
 * so the schema-driven controls render only the fields listed here.
 *
 * Keeping the mirror lets a control's options and defaults still come from
 * the model's own `inputs` schema while guaranteeing the submit is valid.
 */
export const ACCEPTED_PARAMS: Record<StudioKind, readonly string[]> = {
  image: [
    "prompt",
    "negative_prompt",
    "image_size",
    "aspect_ratio",
    "num_images",
    "seed",
    "image_url",
    "images_list",
    "strength",
  ],
  video: [
    "prompt",
    "negative_prompt",
    "image_url",
    "images_list",
    "last_image",
    "aspect_ratio",
    "resolution",
    "seed",
  ],
  audio: ["text", "voice", "voice_id", "mood", "style_directions"],
  lipsync: ["video_url", "audio_url", "image_url", "prompt", "resolution", "seed"],
  video2video: [
    "video_url",
    "image_url",
    "prompt",
    "aspect_ratio",
    "resolution",
    "seed",
    "scale",
  ],
  recast: [
    "video_url",
    "image_url",
    "prompt",
    "aspect_ratio",
    "resolution",
    "seed",
    "character_orientation",
  ],
};

/** Params we own rather than the vendor: accepted for every kind. */
export const OUR_PARAMS = ["duration_sec", "quality"] as const;

/** Handled by dedicated UI (the prompt box, the uploader) — never a control. */
export const HANDLED_ELSEWHERE = new Set([
  "prompt",
  "text",
  "image_url",
  "images_list",
  "last_image",
  "video_url",
  "audio_url",
  "duration_sec",
]);

export function accepts(kind: StudioKind, name: string): boolean {
  return (
    ACCEPTED_PARAMS[kind].includes(name) ||
    (OUR_PARAMS as readonly string[]).includes(name)
  );
}
