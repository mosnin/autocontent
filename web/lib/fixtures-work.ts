// Fixture data for the work departments' preview views (Content, SEO,
// Playbooks). Never imported by real pages.

import type { Failures, JobMetrics, MetricsSummary, Template } from "@/components/app/content/types";
import type {
  Article,
  AudioProviders,
  CreativeBrief,
  ImagePost,
  Job,
  Kit,
  Niche,
  NichePerformance,
  PostMetrics,
  ScriptModelOption,
  SpendHistory,
  StylePreset,
  TodaySpend,
  VideoModelOption,
} from "./types";

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const dayStr = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

const brief = (over: Partial<CreativeBrief> = {}): CreativeBrief => ({
  hooks: { preferred_mechanisms: ["mistake_or_stakes", "myth_bust"], banned_openers: ["hey guys", "in this video"], example_hooks: ["You're salting your pasta water wrong", "Stop rinsing your pasta"] },
  narrative: { language: "English", pov: "a friendly Italian grandmother", pacing: "quick, punchy", reading_level: "grade 6", cta_policy: "only 'follow for part 2'", must_include: [], must_avoid: ["calorie counts", "brand names"] },
  visual: { camera_language: "slow push-ins, overhead flat lays", lighting: "warm window light", color_palette: "terracotta, cream, basil green", negative_visuals: ["plastic packaging", "phones"] },
  audio: { music_enabled: true, music_mood: "warm acoustic, mandolin", caption_style: { font: "Arial Black", font_size: 96, text_hex: "FFFFFF", outline_hex: "000000", uppercase: true, position: "bottom" } },
  prompt_overrides: { ideation: "", scriptwriter: "end every script on a question", visual_director: "", qa: "" },
  ...over,
});

export const FX_NICHES: Niche[] = [
  {
    id: "n1",
    user_id: "u1",
    title: "Pasta at home",
    description: "Short, warm lessons that make fresh pasta feel doable on a weeknight.",
    target_audience: "Home cooks, 25–45, who want restaurant pasta without the fuss",
    hashtags: ["pasta", "homecooking", "italianfood"],
    visual_style: "Warm claymation kitchen, soft window light, flour dust in the air",
    voice: "sage",
    target_duration_sec: 45,
    scene_count: 6,
    image_quality: "medium",
    video_resolution: "720p",
    scene_max_duration_sec: 5,
    tts_style_directions: "warm, a little conspiratorial",
    character_description: "Nonna Rosa, a tiny clay grandmother in a floral apron",
    creative_brief: brief(),
    video_provider: "grok",
    fal_model: "",
    script_model: "",
    voice_provider: "openai",
    elevenlabs_voice_id: "",
    music_provider: "auto",
    design_kit_id: "k1",
    writing_kit_id: null,
    posting_windows: [{ hour: 18, minute: 30, tz: "America/New_York" }],
    platforms: ["tiktok", "reels", "shorts"],
    daily_spend_cap_usd: "8.00",
    approve_before_post: true,
    created_at: ago(24 * 40),
    archived_at: null,
  },
  {
    id: "n2",
    user_id: "u1",
    title: "Sauce science",
    description: "Why sauces break, emulsify and cling, explained in under a minute.",
    target_audience: "Curious cooks who like knowing why",
    hashtags: ["foodscience", "sauce"],
    visual_style: "Clean macro shots, steel pans, high-contrast studio light",
    voice: "onyx",
    target_duration_sec: 60,
    scene_count: 7,
    image_quality: "high",
    video_resolution: "720p",
    scene_max_duration_sec: 6,
    tts_style_directions: null,
    character_description: null,
    creative_brief: brief({ hooks: { preferred_mechanisms: ["curiosity_gap"], banned_openers: [], example_hooks: [] } }),
    video_provider: "fal",
    fal_model: "fal-ai/kling-video/v2",
    script_model: "claude-sonnet",
    voice_provider: "elevenlabs",
    elevenlabs_voice_id: "21m00Tcm4TlvDq8ikWAM",
    music_provider: "generated",
    design_kit_id: null,
    writing_kit_id: "k2",
    posting_windows: [{ hour: 12, minute: 0, tz: "America/Los_Angeles" }],
    platforms: ["shorts"],
    daily_spend_cap_usd: "5.00",
    approve_before_post: false,
    created_at: ago(24 * 12),
    archived_at: null,
  },
];

const script = (hook: string, topic: string) => ({ idea: { hook, topic } });

export const FX_JOBS: Job[] = [
  { id: "v2", user_id: "u1", niche_id: "n1", platform: "tiktok", status: "awaiting_approval", created_at: ago(3), scheduled_for: null, provider_post_id: null, error: null, rendered: { path: "/x.mp4", duration_sec: 44 }, script: script("The one salt rule for pasta water", "Salting pasta water") },
  { id: "v4", user_id: "u1", niche_id: "n1", platform: "reels", status: "animating", created_at: ago(0.3), scheduled_for: null, provider_post_id: null, error: null, script: script("Why your carbonara scrambles", "Carbonara technique") },
  { id: "v9", user_id: "u1", niche_id: "n2", platform: "shorts", status: "failed", created_at: ago(4), scheduled_for: null, provider_post_id: null, error: "QA rejected the hook: it takes 6 seconds to get to the point (limit 3s).", script: script("Knife skills for pasta night", "Knife skills") },
  { id: "v5", user_id: "u1", niche_id: "n2", platform: "shorts", status: "scripting", created_at: ago(0.1), scheduled_for: null, provider_post_id: null, error: null, script: null },
  { id: "v3", user_id: "u1", niche_id: "n1", platform: "shorts", status: "done", created_at: ago(26), scheduled_for: ago(20), provider_post_id: "ayr_3", error: null, rendered: { path: "/x.mp4", duration_sec: 41 }, script: script("Ragù in 40 minutes, not 4 hours", "Fast ragù") },
  { id: "v1", user_id: "u1", niche_id: "n1", platform: "tiktok", status: "done", created_at: ago(70), scheduled_for: ago(64), provider_post_id: "ayr_1", error: null, rendered: { path: "/x.mp4", duration_sec: 45 }, script: script("3 pasta mistakes every home cook makes", "Common pasta mistakes") },
  { id: "v6", user_id: "u1", niche_id: "n2", platform: "shorts", status: "done", created_at: ago(96), scheduled_for: ago(90), provider_post_id: "ayr_6", error: null, rendered: { path: "/x.mp4", duration_sec: 58 }, script: script("Why butter sauces break", "Emulsions") },
];

export const FX_JOB_DETAIL: Job & { script: { idea: { hook: string; topic: string }; cta: string; scenes: { index: number; narration: string; visual_prompt: string; motion_prompt: string; duration_sec: number }[] } } = {
  ...FX_JOBS[5],
  script: {
    idea: { hook: "3 pasta mistakes every home cook makes", topic: "Common pasta mistakes" },
    cta: "Follow for part 2: the sauce.",
    scenes: [
      { index: 0, narration: "You're making three pasta mistakes, and the first one happens before the water boils.", visual_prompt: "", motion_prompt: "slow push-in on a clay pot", duration_sec: 5 },
      { index: 1, narration: "Too little water. Your pasta needs room to move, or it glues together.", visual_prompt: "", motion_prompt: "overhead, pasta swirling", duration_sec: 5 },
      { index: 2, narration: "Not enough salt. It should taste like a mild sea.", visual_prompt: "", motion_prompt: "Nonna pours a handful of salt", duration_sec: 4.5 },
    ],
  },
};

const metric = (offsetDays: number, views: number): PostMetrics => ({
  id: `m${offsetDays}`,
  job_id: "v1",
  provider_post_id: "ayr_1",
  platform: "tiktok",
  sampled_at: `${dayStr(offsetDays)}T11:00:00Z`,
  views,
  likes: Math.round(views * 0.08),
  comments: Math.round(views * 0.004),
  shares: Math.round(views * 0.01),
  saves: Math.round(views * 0.02),
  watch_time_sec: String(views * 21),
  avg_watch_time_sec: "21.4",
  completion_rate: "0.46",
  reach: Math.round(views * 0.9),
  impressions: Math.round(views * 1.3),
  raw: {},
  created_at: `${dayStr(offsetDays)}T11:00:00Z`,
});

export const FX_JOB_METRICS: JobMetrics = (() => {
  const history = [2, 1, 0].map((d, i) => metric(d, [9800, 31200, 48200][i]));
  return { latest: history[history.length - 1], history };
})();

export const FX_SPEND: TodaySpend = { by_niche: { n1: "3.42", n2: "1.10" }, total_usd: "4.52" };

export const FX_METRICS_SUMMARY: MetricsSummary = { total_views: 186_400, sampled_videos: 21 };

export const FX_IMAGE_POSTS: ImagePost[] = [
  { id: "c3", user_id: "u1", niche_id: "n1", campaign_id: null, kind: "carousel", topic: "5 sauces in 15 minutes", status: "awaiting_approval", payload: { slide_count: 5, caption: "5 sauces in 15 minutes\nSave this for weeknights.", hashtags: ["pasta"], slides: [{ index: 0, heading: "Aglio e olio" }, { index: 1, heading: "Cacio e pepe" }, { index: 2, heading: "Burro e salvia" }] }, provider_post_id: null, error: null, created_at: ago(5), updated_at: ago(4.5) },
  { id: "c4", user_id: "u1", niche_id: "n2", campaign_id: null, kind: "carousel", topic: "", status: "generating", payload: { slide_count: 6 }, provider_post_id: null, error: null, created_at: ago(0.2), updated_at: ago(0.1) },
  { id: "c2", user_id: "u1", niche_id: "n2", campaign_id: null, kind: "single", topic: "The emulsion cheat sheet", status: "failed", payload: { slide_count: 1 }, provider_post_id: null, error: "Image provider timed out after 3 attempts.", created_at: ago(30), updated_at: ago(29) },
  { id: "c1", user_id: "u1", niche_id: "n1", campaign_id: null, kind: "carousel", topic: "Pasta shapes and the sauces they want", status: "done", payload: { slide_count: 7, caption: "Pasta shapes and the sauces they want" }, provider_post_id: "ayr_c1", error: null, created_at: ago(50), updated_at: ago(44) },
];

export const FX_TEMPLATES: Template[] = [
  { id: "t1", kind: "image", name: "Marble flat lay", description: "Product centered on white marble, soft top light.", prompt: "…", reference_key: "", is_published: true, created_at: ago(400) },
  { id: "t2", kind: "carousel", name: "Recipe card stack", description: "Five-slide recipe with bold numbered steps.", prompt: "…", reference_key: "", is_published: true, created_at: ago(300) },
  { id: "t3", kind: "video", name: "Clay kitchen", description: "Warm claymation kitchen, flour dust, window light.", prompt: "Warm claymation kitchen…", reference_key: "", is_published: true, created_at: ago(200) },
];

export const FX_FAILURES: Failures = {
  failures: [
    { kind: "job", id: "v9", niche_id: "n2", niche_title: "Sauce science", label: "Shorts video", error: "QA rejected the hook: it takes 6 seconds to get to the point (limit 3s).", category: "content_qa", created_at: ago(4) },
    { kind: "image_post", id: "c2", niche_id: "n2", niche_title: "Sauce science", label: "Still image", error: "Image provider timed out after 3 attempts.", category: "provider_error", created_at: ago(30) },
  ],
  counts: { content_qa: 1, provider_error: 1 },
  total: 2,
};

const md = `The difference between good pasta and great pasta is rarely the recipe. It's three small habits most home cooks skip.

## Start with more water than you think

Pasta releases starch as it cooks. In a crowded pot that starch turns the water gluey, and the noodles stick. Use **at least four litres per 500 g** of dried pasta.

## Salt like you mean it

The water should taste like a mild sea. As a rule of thumb:

- 10 g of salt per litre for dried pasta
- 8 g per litre for fresh pasta
- Never add oil; it keeps sauce from clinging

> Salt the water once it boils, not before. It dissolves faster and won't pit your pot.

## Finish the pasta in the sauce

Pull the pasta a minute early and toss it in the pan with a splash of cooking water. Read more in [our sauce guide](https://example.com/sauce).`;

export const FX_ARTICLES: Article[] = [
  {
    id: "a1",
    user_id: "u1",
    niche_id: "n1",
    status: "done",
    topic: "Fresh pasta at home",
    focus_keyword: "fresh pasta at home",
    title: "The complete guide to fresh pasta at home",
    slug: "fresh-pasta-at-home",
    meta_description: "Make silky fresh pasta at home with three habits restaurant cooks swear by: more water, proper salt, and finishing in the sauce.",
    keywords: ["fresh pasta", "pasta water salt", "how to cook pasta"],
    article_markdown: md,
    schema_jsonld: JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: "The complete guide to fresh pasta at home" }),
    hero_image_path: null,
    hero_image_alt: "Fresh tagliatelle nests dusted with flour on a wooden board",
    quality: { overall: 91, keywordDensity: 1.4, eeatScore: 88, readability: 72, notes: ["Add a first-hand tip in the intro to strengthen experience signals.", "Two headings could include the focus keyword."] },
    link_suggestions: [
      { anchor: "our sauce guide", targetUrl: "https://pastaclub.example/sauces", score: 0.92 },
      { anchor: "pasta shapes", targetUrl: "https://pastaclub.example/shapes", score: 0.81 },
    ],
    word_count: 2140,
    error: null,
    created_at: ago(200),
    updated_at: ago(198),
  },
  { id: "a2", user_id: "u1", niche_id: "n2", status: "writing", topic: "Why emulsions break", focus_keyword: "sauce emulsion", title: null, slug: null, meta_description: null, keywords: [], article_markdown: null, schema_jsonld: null, hero_image_path: null, hero_image_alt: null, quality: null, link_suggestions: [], word_count: null, error: null, created_at: ago(0.5), updated_at: ago(0.2) },
  { id: "a3", user_id: "u1", niche_id: "n1", status: "failed", topic: "Best flour for pasta", focus_keyword: "best flour for pasta", title: null, slug: null, meta_description: null, keywords: [], article_markdown: null, schema_jsonld: null, hero_image_path: null, hero_image_alt: null, quality: null, link_suggestions: [], word_count: null, error: "Research step found no ranking pages for the keyword; try a broader topic.", created_at: ago(30), updated_at: ago(29) },
  { id: "a4", user_id: "u1", niche_id: "n2", status: "done", topic: "Pan sauce basics", focus_keyword: "pan sauce", title: "Pan sauce basics: the 5-minute upgrade", slug: "pan-sauce-basics", meta_description: "", keywords: ["pan sauce"], article_markdown: "Short.", schema_jsonld: null, hero_image_path: null, hero_image_alt: null, quality: { overall: 84, keywordDensity: 1.1, eeatScore: 80, readability: 76, notes: [] }, link_suggestions: [], word_count: 1380, error: null, created_at: ago(400), updated_at: ago(398) },
];

const perfJobs = (nicheId: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    job_id: `${nicheId}-j${i}`,
    created_at: ago(24 * (i + 1)),
    platform: ["tiktok", "reels", "shorts"][i % 3],
    status: i === 3 ? "failed" : "done",
    hook: ["3 pasta mistakes every home cook makes", "Ragù in 40 minutes, not 4 hours", "Why fresh tagliatelle holds sauce better", "Knife skills for pasta night", "The one salt rule for pasta water", "Stop rinsing your pasta"][i % 6],
    topic: null,
    visual_style: null,
    scene_count: 6,
    target_duration_sec: 45,
    cost_usd: (0.62 + (i % 4) * 0.08).toFixed(4),
    views: i === 3 ? null : [48200, 12400, 31900, 0, 8800, 15100][i % 6],
    likes: null,
    watch_time_sec: null,
    avg_watch_time_sec: null,
    completion_rate: null,
  }));

export const FX_PERFORMANCE: Record<string, NichePerformance> = {
  n1: { niche_id: "n1", days: 30, jobs: perfJobs("n1", 6), summary: { total_videos: 18, total_spend_usd: "12.84", total_views: 116_400, avg_views_per_video: 6467, best_job_id: "n1-j0", worst_job_id: "n1-j3" } },
  n2: { niche_id: "n2", days: 30, jobs: perfJobs("n2", 3), summary: { total_videos: 6, total_spend_usd: "6.10", total_views: 22_900, avg_views_per_video: 3817, best_job_id: null, worst_job_id: null } },
};

export const FX_SPEND_HISTORY: SpendHistory = {
  days: 30,
  total_usd: "12.84",
  rows: Array.from({ length: 30 }, (_, i) => ({ day: dayStr(29 - i), niche_id: "n1", cost_usd: (i % 5 === 0 ? 0 : 0.3 + ((i * 7) % 10) / 12).toFixed(4) })),
};

export const FX_VIDEO_MODELS: VideoModelOption[] = [
  { provider: "grok", model_id: "", name: "Grok Imagine", tagline: "Fast default", usd_per_second: "0.050", available: true },
  { provider: "fal", model_id: "fal-ai/kling-video/v2", name: "Kling 2", tagline: "Cinematic motion", usd_per_second: "0.280", available: true },
  { provider: "fal", model_id: "fal-ai/veo3", name: "Veo 3", tagline: "Highest fidelity", usd_per_second: "0.750", available: false },
];
export const FX_SCRIPT_MODELS: ScriptModelOption[] = [
  { model_id: "", name: "Platform default", tagline: "", usd_per_m_input: "-", usd_per_m_output: "-", available: true },
  { model_id: "claude-sonnet", name: "Claude Sonnet", tagline: "", usd_per_m_input: "3.00", usd_per_m_output: "15.00", available: true },
];
export const FX_AUDIO: AudioProviders = {
  voice_providers: [
    { provider: "openai", name: "OpenAI TTS", tagline: "", available: true },
    { provider: "elevenlabs", name: "ElevenLabs", tagline: "", available: true },
  ],
  generated_music_available: true,
};
export const FX_KITS: Kit[] = [
  { id: "k1", user_id: "u1", kind: "design", name: "Pasta Club look", description: "", content: "", rules: {}, is_default: true, created_at: ago(500), updated_at: ago(500) },
  { id: "k2", user_id: "u1", kind: "writing", name: "Friendly expert", description: "", content: "", rules: {}, is_default: false, created_at: ago(500), updated_at: ago(500) },
];
export const FX_PRESETS: StylePreset[] = [
  { id: "p1", name: "Claymation", tagline: "Handmade, warm, tactile", visual_style: "Warm claymation…", character_suggestion: "", reference_video_url: null, swatch: "linear-gradient(135deg,#f3c9a8,#c9774e)" },
  { id: "p2", name: "Film grain", tagline: "70s documentary", visual_style: "16mm film grain…", character_suggestion: "", reference_video_url: null, swatch: "linear-gradient(135deg,#d9c89b,#6b5a3a)" },
  { id: "p3", name: "Studio macro", tagline: "Crisp, high contrast", visual_style: "Macro product shots…", character_suggestion: "", reference_video_url: null, swatch: "linear-gradient(135deg,#d6dde4,#37424d)" },
  { id: "p4", name: "Neon noir", tagline: "Moody, cinematic", visual_style: "Neon noir…", character_suggestion: "", reference_video_url: null, swatch: "linear-gradient(135deg,#7b5cff,#1a1033)" },
];
