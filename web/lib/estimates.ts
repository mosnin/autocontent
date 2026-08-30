// THE number, client side. Every per-video price the UI shows comes from
// POST /api/v1/niches/estimate — the same arithmetic the enqueue gate and
// the ledger use — never from a client-side rate card. lib/cost-estimator
// remains only as an instant-feedback fallback while the server answer is
// in flight (and its line-item breakdown display).

export interface VideoEstimateConfig {
  scene_count: number;
  image_quality: "low" | "medium" | "high";
  scene_max_duration_sec: number;
  target_duration_sec: number;
  video_provider?: "grok" | "fal";
  fal_model?: string;
  music_provider?: "auto" | "library" | "generated";
}

export interface VideoEstimate {
  estimated_usd: string; // pre-margin — what the caps are checked against
  charge_usd: string; // margin included — what the balance is debited
  billing_enabled: boolean;
  margin: number;
}

export async function fetchVideoEstimate(
  config: VideoEstimateConfig,
): Promise<VideoEstimate> {
  const res = await fetch("/api/proxy/api/v1/niches/estimate", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<VideoEstimate>;
}

/** Stable SWR key for a config (field order pinned). */
export function estimateKey(config: VideoEstimateConfig): string {
  return [
    "video-estimate",
    config.scene_count,
    config.image_quality,
    config.scene_max_duration_sec,
    config.target_duration_sec,
    config.video_provider ?? "grok",
    config.fal_model ?? "",
    config.music_provider ?? "auto",
  ].join(":");
}
