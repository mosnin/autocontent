"use client";

import * as React from "react";

import { clientFetch } from "@/lib/client-fetcher";

/**
 * Backend `MARKETER_ADS_ENABLED`. Defaults false so a failed fetch
 * never surfaces the Ads product as live.
 */
export function useAdsEnabled(): boolean {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    clientFetch<{ enabled?: boolean }>("/api/v1/ads/overview")
      .then((ov) => {
        if (!cancelled) setEnabled(Boolean(ov.enabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
