// Fixture data for the short-video previews (/preview/app/content/short*). Not used in the product.
import { DEFAULT_SETTINGS, type Estimate, type Options, type ShortVideoBatch, type ShortVideoItem, type StockClip, type Upload } from "./short-video";

const clip = (creator: string, provider: "pexels" | "pixabay", id: string): StockClip => ({
  provider,
  provider_id: id,
  kind: "video",
  page_url: "",
  creator,
  creator_url: "",
  licence: provider === "pexels" ? "Pexels License" : "Pixabay Content License",
  licence_url: "",
  query: "coffee",
});

const done = (detail = "") => ({ state: "done" as const, detail });

const item = (over: Partial<ShortVideoItem>): ShortVideoItem => ({
  id: `item-${over.variant ?? 1}`,
  variant: 1,
  attempt: 1,
  status: "queued",
  stage: "queued",
  progress: 0,
  stages: {},
  hook: "",
  clips: [],
  video_path: null,
  srt_path: null,
  vtt_path: null,
  duration_sec: null,
  spent_micros: 0,
  error: null,
  ...over,
});

export const FX_SV_OPTIONS: Options = {
  defaults: DEFAULT_SETTINGS,
  voices: { openai: ["alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"], elevenlabs: [] },
  footage_sources: ["pexels", "pixabay", "uploads"],
  music_modes: ["none", "library", "generated"],
  limits: { max_variants: 10, approval_variants: 3, upload_types: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"] },
};

export const FX_SV_UPLOADS: Upload[] = [
  { id: "up-1", kind: "video", filename: "storefront.mp4", status: "ready", error: null },
  { id: "up-2", kind: "image", filename: "latte-art.jpg", status: "ready", error: null },
];

export const FX_SV_ESTIMATE: Estimate = { per_variant_usd: "0.0612", total_usd: "0.1836", cap_usd: "0.2754", needs_approval: false, lines: { script: "0.05", voice: "0.0068", timing: "0.0044" } };

const settings = DEFAULT_SETTINGS;

export const FX_SV_BATCHES: ShortVideoBatch[] = [
  {
    id: "b-running",
    title: "Three coffee myths baristas wish you'd stop believing",
    source: "topic",
    topic: "Three coffee myths baristas wish you'd stop believing",
    settings,
    variants: 3,
    status: "running",
    estimate_micros: 183_600,
    cap_micros: 275_400,
    spent_micros: 112_480,
    error: null,
    created_at: "2026-11-25T21:12:00Z",
    items: [
      item({
        variant: 1,
        status: "done",
        stage: "done",
        progress: 100,
        hook: "Stop rinsing your beans. Here's why.",
        stages: { script: done(), voice: done("28.4s"), timing: done("71 words"), footage: done("9 clips"), edit: done("9 cuts"), subtitles: done("14 lines"), music: done(), render: done() },
        clips: [clip("Ana Lima", "pexels", "1"), clip("kai_films", "pixabay", "2"), clip("Rui Costa", "pexels", "3")],
        video_path: "/x.mp4",
        srt_path: "/x.srt",
        vtt_path: "/x.vtt",
        spent_micros: 61_240,
      }),
      item({
        variant: 2,
        status: "running",
        stage: "footage",
        progress: 38,
        hook: "Is espresso really stronger than drip?",
        stages: { script: done(), voice: done("29.1s"), timing: done("74 words"), footage: { state: "running" } },
        spent_micros: 51_240,
      }),
      item({ variant: 3, status: "queued" }),
    ],
  },
  {
    id: "b-approval",
    title: "Cold brew at home in five minutes",
    source: "topic",
    topic: "Cold brew at home in five minutes",
    settings: { ...settings, music: { ...settings.music, mode: "generated" } },
    variants: 5,
    status: "awaiting_approval",
    estimate_micros: 4_310_000,
    cap_micros: 6_465_000,
    spent_micros: 0,
    error: null,
    created_at: "2026-11-25T20:40:00Z",
    items: [],
  },
  {
    id: "b-partial",
    title: "Why your grinder matters more than your machine",
    source: "script",
    topic: "",
    settings: { ...settings, look: { ...settings.look, aspect: "1:1" } },
    variants: 2,
    status: "partial",
    estimate_micros: 24_000,
    cap_micros: 100_000,
    spent_micros: 20_120,
    error: null,
    created_at: "2026-11-24T17:02:00Z",
    items: [
      item({ variant: 1, status: "done", stage: "done", progress: 100, hook: "Your grinder matters more than your machine.", clips: [clip("Mia Park", "pexels", "9")], video_path: "/y.mp4", srt_path: "/y.srt", vtt_path: "/y.vtt", spent_micros: 10_060, stages: { script: done("your script"), voice: done(), timing: done(), footage: done(), edit: done(), subtitles: done(), music: done(), render: done() } }),
      item({ variant: 2, status: "failed", stage: "footage", progress: 38, hook: "Your grinder matters more than your machine.", error: "no footage found for this script; try other words, or add uploads", stages: { script: done(), voice: done(), timing: done(), footage: { state: "failed" } }, spent_micros: 10_060 }),
    ],
  },
];
