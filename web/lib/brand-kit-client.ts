// Client-safe typed client for the Brand Kit API.
//
// Reads go through SWR using BRAND_KIT_KEY + `clientFetch` (see
// lib/client-fetcher.ts). The write goes through the same /api/proxy/... handler
// so the Clerk JWT is attached server-side. NOTHING here may import server-only
// modules — this file runs in the browser.

import { ApiError, clientFetch } from "@/lib/client-fetcher";

// --- Wire types --------------------------------------------------------

/**
 * The workspace-wide brand identity. Seeds new channel drafts: when a channel
 * is described in one sentence during onboarding, the draft is steered to match
 * this name, tone, banned words, and hashtags. The backend returns an empty kit
 * (all fields blank) when none has been saved yet.
 */
export interface BrandKit {
  brand_name: string;
  tagline: string;
  tone_of_voice: string;
  target_audience: string;
  banned_words: string[];
  preferred_hashtags: string[];
  /** Empty string, or a `#rrggbb` hex string. */
  color_hex: string;
  updated_at: string | null;
  created_at: string | null;
}

/** The mutable subset sent on PUT. */
export interface BrandKitInput {
  brand_name: string;
  tagline: string;
  tone_of_voice: string;
  target_audience: string;
  banned_words: string[];
  preferred_hashtags: string[];
  color_hex: string;
}

/** A blank kit — used as a client-side fallback if the initial fetch fails. */
export const EMPTY_BRAND_KIT: BrandKit = {
  brand_name: "",
  tagline: "",
  tone_of_voice: "",
  target_audience: "",
  banned_words: [],
  preferred_hashtags: [],
  color_hex: "",
  updated_at: null,
  created_at: null,
};

/** The server 422s on anything that isn't "" or a 6-digit `#rrggbb` string. */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// --- Read (SWR) --------------------------------------------------------

/** SWR key + fetcher for the current kit. */
export const BRAND_KIT_KEY = "/api/v1/brand-kit";
export const brandKitFetcher = clientFetch<BrandKit>;

// --- Write (proxy) -----------------------------------------------------

/**
 * Persist the kit. Hashtags are normalized to a leading '#' server-side, so
 * either form is accepted. Throws {@link ApiError} on a non-2xx response.
 */
export async function saveBrandKit(input: BrandKitInput): Promise<BrandKit> {
  const res = await fetch(`/api/proxy${BRAND_KIT_KEY}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || `${res.status}`);
  }
  return (await res.json()) as BrandKit;
}
