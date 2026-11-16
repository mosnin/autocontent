// Wire types the work departments read that lib/types.ts doesn't declare.
import type { PostMetrics } from "@/lib/types";

export interface Template {
  id: string;
  kind: "video" | "image" | "carousel";
  name: string;
  description: string;
  prompt: string;
  reference_key: string;
  is_published: boolean;
  created_at: string;
}

export type FailureKind = "job" | "image_post" | "article";
export type FailureCategory = "content_qa" | "render_qa" | "spend_cap" | "timeout_stuck" | "provider_error" | "other";

export interface FailureItem {
  kind: FailureKind;
  id: string;
  niche_id: string | null;
  niche_title: string | null;
  label: string;
  error: string | null;
  category: FailureCategory;
  created_at: string | null;
}

export interface Failures {
  failures: FailureItem[];
  counts: Record<string, number>;
  total: number;
}

export interface MetricsSummary {
  total_views: number;
  sampled_videos: number;
}

export interface JobMetrics {
  latest: PostMetrics | null;
  history: PostMetrics[];
}

/** The full script shape (lib/types only declares `idea`). */
export interface FullScript {
  idea: { hook: string; topic: string };
  cta?: string | null;
  total_duration_sec?: number;
  scenes?: { index: number; narration: string; visual_prompt: string; motion_prompt: string; duration_sec: number }[];
}
