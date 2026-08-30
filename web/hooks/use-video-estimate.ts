import useSWR from "swr";

import {
  estimateKey,
  fetchVideoEstimate,
  type VideoEstimate,
  type VideoEstimateConfig,
} from "@/lib/estimates";

/**
 * The server's authoritative per-video estimate for a config, refreshed as
 * the config changes. Returns null until the first answer lands — callers
 * fall back to the client rate-card preview for instant feedback.
 */
export function useVideoEstimate(
  config: VideoEstimateConfig | null,
): VideoEstimate | null {
  const { data } = useSWR(
    config ? estimateKey(config) : null,
    () => fetchVideoEstimate(config!),
    { revalidateOnFocus: false, keepPreviousData: true, dedupingInterval: 5000 },
  );
  return data ?? null;
}
