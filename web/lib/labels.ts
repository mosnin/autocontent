/**
 * Human display names for wire enums. Raw enum values must never reach
 * the user — route every platform (and future enum) through here.
 */
export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}
