/**
 * Warm accent tokens (DESIGN_SPEC Amendment 2). Positive / success / live
 * moments on marketing surfaces use this amber→rose gradient; cool
 * success colors are retired everywhere. The brand recording-orange stays
 * the live-pulse accent; these are the same family.
 *
 * Import from the system barrel; never hand-roll another success accent.
 */

/** The warm gradient, as a CSS value (inline `style.background`, SVG-adjacent CSS). */
export const WARM_GRADIENT = "linear-gradient(135deg,#f59e0b,#f43f5e)";

/** Gradient endpoints for SVG `<linearGradient>` stops. amber-500 → rose-500. */
export const WARM_FROM = "#f59e0b";
export const WARM_TO = "#f43f5e";

/** Low-opacity wash of the warm gradient, for chip and pill backgrounds. */
export const WARM_GRADIENT_SOFT =
  "linear-gradient(135deg,rgba(245,158,11,0.13),rgba(244,63,94,0.10))";

/** Full-strength warm gradient fill: progress fills, check badges, meters. */
export const warmBg = "bg-[linear-gradient(135deg,#f59e0b,#f43f5e)]";

/** Warm gradient text via bg-clip: stat highlights, emphatic labels. */
export const warmText =
  "bg-[linear-gradient(135deg,#f59e0b,#f43f5e)] bg-clip-text text-transparent";

/**
 * The warm success chip: soft gradient wash, amber hairline, amber ink.
 * Pair with the pill shape classes at the call site (rounded-full, padding).
 */
export const warmChip =
  "border border-amber-600/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.13),rgba(244,63,94,0.10))] text-amber-700";

/** Small pass/ok dots are solid amber-500 (never a gradient at dot size). */
export const warmDot = "bg-amber-500";

/** SVG variant of the pass dot, for `<circle className=…>`. */
export const warmDotFill = "fill-amber-500";
