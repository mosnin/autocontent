/**
 * Showcase media - drop-in slots for real platform output.
 *
 * Public surface:
 *   - `HomeShowcase`   the homepage band, driven by `HOMEPAGE_SHOWCASE`
 *   - `ShowcaseSlot`   render one registry entry anywhere
 *   - `ShowcaseGrid` / `ShowcaseRail`   several at once
 *   - `ShowcaseImage` / `ShowcaseVideo` the primitives, if you need them raw
 *   - `SHOWCASE_SLOTS` and friends      the registry itself
 *
 * To put real media on the site you only ever edit `showcase.config.ts` -
 * see the instructions at the top of that file and `public/showcase/README.md`.
 */
export { HomeShowcase } from "./showcase-section";
export { ShowcaseGrid, ShowcaseRail, ShowcaseSlot } from "./showcase-layout";
export { ShowcaseImage } from "./showcase-image";
export { ShowcaseVideo } from "./showcase-video";
export { SlotFrame, SlotPlaceholder } from "./placeholder";
export {
  HOMEPAGE_SHOWCASE,
  SHOWCASE_KINDS,
  SHOWCASE_SLOTS,
  aspectLabel,
  expectedPath,
  expectedPosterPath,
  getSlot,
  getSlots,
  isVideoSlot,
  type ShowcaseAspect,
  type ShowcaseKind,
  type ShowcaseMedium,
  type ShowcaseSlot as ShowcaseSlotConfig,
} from "./showcase.config";
