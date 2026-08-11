/**
 * Shared motion constants for the marketing surface (see
 * web/marketing/DESIGN_SPEC.md). Every reveal uses the same ease and
 * viewport so the whole site breathes at one rhythm.
 */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const VIEWPORT = { once: true, margin: "-80px" } as const;

export const REVEAL_DURATION = 0.7;
