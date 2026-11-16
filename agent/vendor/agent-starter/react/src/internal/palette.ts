/**
 * Twelve hues dark enough for white initials (WCAG AA, ≥ 4.5:1) and distinct
 * on light and dark surfaces.
 */
export const SWARM_PALETTE: readonly string[] = [
  "#2563eb",
  "#be185d",
  "#047857",
  "#b45309",
  "#7c3aed",
  "#0e7490",
  "#b91c1c",
  "#4d7c0f",
  "#a21caf",
  "#0f766e",
  "#c2410c",
  "#4f46e5",
];

/** 32-bit FNV-1a hash: stable across sessions and runtimes. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic color for a swarm participant: the same senderId always gets the same color. */
export function senderColor(senderId: string, palette: readonly string[] = SWARM_PALETTE): string {
  if (palette.length === 0) return "#6b7280";
  return palette[hashString(senderId) % palette.length] ?? "#6b7280";
}
