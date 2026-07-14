// Manual TS mirrors of the pydantic models in
// src/marketer/models/schemas.py. Keep these in sync when the
// schema changes.

export type Platform = "tiktok" | "reels" | "shorts";

export type ImageQuality = "low" | "medium" | "high";

export type VideoResolution = "480p" | "720p";

export interface PostingWindow {
  hour: number;
  minute: number;
  tz: string;
}

export interface Niche {
  id: string;
  user_id: string;
  title: string;
  description: string;
  target_audience: string;
  hashtags: string[];
  visual_style: string;
  voice: string;
  target_duration_sec: number;
  scene_count: number;
  image_quality: ImageQuality;
  video_resolution: VideoResolution;
  scene_max_duration_sec: number;
  tts_style_directions: string | null;
  posting_windows: PostingWindow[];
  platforms: Platform[];
  daily_spend_cap_usd: string;
  approve_before_post: boolean;
  created_at: string;
  archived_at: string | null;
}

export type JobStatus =
  | "queued"
  | "ideating"
  | "scripting"
  | "generating_images"
  | "animating"
  | "voicing"
  | "editing"
  | "captioning"
  | "qa"
  | "scheduling"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "skipped";

export interface Job {
  id: string;
  user_id: string;
  niche_id: string;
  platform: Platform;
  status: JobStatus;
  created_at: string;
  scheduled_for: string | null;
  provider_post_id: string | null;
  error: string | null;
  rendered?: { path: string; duration_sec: number } | null;
  script?: { idea: { hook: string; topic: string } } | null;
}

export interface TodaySpend {
  by_niche: Record<string, string>;
  total_usd: string;
}

export interface SpendHistoryRow {
  /** UTC calendar day, e.g. "2026-01-15" */
  day: string;
  niche_id: string;
  /** Decimal serialized as string by pydantic, e.g. "0.2500" */
  cost_usd: string;
}

export interface SpendHistory {
  rows: SpendHistoryRow[];
  days: number;
  total_usd: string;
}

export interface AyrshareConnectStatus {
  connected: boolean;
  profile_key: string | null;
}

export interface AyrshareConnectResponse {
  profile_key: string;
  login_url: string;
}

export interface User {
  id: string;
  email: string;
  ayrshare_profile_key: string | null;
  global_daily_cap_usd: string | null;
  created_at: string;
}

export interface PostMetrics {
  id: string;
  job_id: string;
  provider_post_id: string;
  platform: string;
  sampled_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  watch_time_sec: string | null;       // Decimal serialized as string
  avg_watch_time_sec: string | null;
  completion_rate: string | null;      // 0..1 as string
  reach: number | null;
  impressions: number | null;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface JobPerformance {
  job_id: string;
  created_at: string;
  platform: string;
  status: string;
  hook: string | null;
  topic: string | null;
  visual_style: string | null;
  scene_count: number | null;
  target_duration_sec: number | null;
  cost_usd: string;
  views: number | null;
  likes: number | null;
  watch_time_sec: string | null;
  avg_watch_time_sec: string | null;
  completion_rate: string | null;
}

export interface PerformanceSummary {
  total_videos: number;
  total_spend_usd: string;
  total_views: number;
  avg_views_per_video: number;
  best_job_id: string | null;
  worst_job_id: string | null;
}

export interface NichePerformance {
  niche_id: string;
  days: number;
  jobs: JobPerformance[];
  summary: PerformanceSummary;
}

export const PLATFORMS: Platform[] = ["tiktok", "reels", "shorts"];
export const QUALITIES: ImageQuality[] = ["low", "medium", "high"];
export const RESOLUTIONS: VideoResolution[] = ["480p", "720p"];

export const TERMINAL_STATUSES: JobStatus[] = ["done", "failed"];

export function isFailed(j: Job): boolean {
  return j.status === "failed";
}

export interface PersonalAccessToken {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  amount_usd: string;
  kind: "purchase" | "debit" | "grant";
  reference: string | null;
  description: string;
  created_at: string;
}

export interface BillingBalance {
  balance_usd: string;
  billing_enabled: boolean;
  margin: number;
  transactions: CreditTransaction[];
}

export interface TokenCreateResponse {
  token: string;
  info: PersonalAccessToken;
}
