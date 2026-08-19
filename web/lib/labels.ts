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

/** "pending_activation" → "Pending activation"; safe fallback for any wire status. */
export function humanizeStatus(status: string): string {
  const words = status.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "onyx" → "Onyx" — display form for lowercase wire names like voices. */
export function titleWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
