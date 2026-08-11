/**
 * Accent tokens.
 *
 * The site has exactly one accent: the export's rgb(65,255,243) teal, held
 * in `--os-accent`. Everything positive — pass dots, meter fills, live
 * chips — is that colour, never a second gradient. The export names are
 * kept (`warmBg`, `warmDot`, …) so the components that already import them
 * keep working; they now resolve to the teal.
 *
 * Import from the system barrel; never hand-roll another accent.
 */

/** The accent, as a CSS value (inline `style.background`, SVG-adjacent CSS). */
export const WARM_GRADIENT = "rgb(65, 255, 243)";

/** Endpoints for SVG `<linearGradient>` stops — a single-hue ramp. */
export const WARM_FROM = "#41fff3";
export const WARM_TO = "#2ad6cb";

/** Low-opacity wash of the accent, for chip and pill backgrounds. */
export const WARM_GRADIENT_SOFT = "rgba(65, 255, 243, 0.12)";

/** Full-strength accent fill: progress fills, meters, check badges. */
export const warmBg = "os-accent-bg";

/** Accent ink: stat highlights, emphatic labels. */
export const warmText = "os-accent-ink";

/** The accent chip: soft wash, accent hairline, accent ink. */
export const warmChip = "os-chip os-chip--accent";

/** Small pass/ok dots. */
export const warmDot = "os-accent-bg";

/** SVG variant of the pass dot, for `<circle className=…>`. */
export const warmDotFill = "os-accent-fill";
