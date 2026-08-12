/**
 * THE SHOWCASE REGISTRY — the one file you edit to put real media on the site.
 * ============================================================================
 *
 * Every showcase slot on the marketing site is declared here. Each entry says
 * what kind of output belongs in it, at what aspect ratio and pixel size, and
 * where its file is expected to live under `public/`. Until a file is wired up
 * the slot renders a deliberate, on-palette PLACEHOLDER carrying exactly that
 * information, so an empty site still reads as designed rather than broken.
 *
 * ---------------------------------------------------------------------------
 * HOW TO SWAP A PLACEHOLDER FOR REAL MEDIA (two steps, no component edits)
 * ---------------------------------------------------------------------------
 *
 *   1. Drop the file at the path the placeholder prints on screen. That path is
 *      derived from the slot's `id` and `kind` by `expectedPath()` below — for
 *      example slot `ad-feed-a` (kind `ad`) expects:
 *
 *          web/public/showcase/ads/ad-feed-a.jpg
 *
 *      For video slots, drop the poster frame next to it as well:
 *
 *          web/public/showcase/ugc/ugc-testimonial.mp4
 *          web/public/showcase/ugc/ugc-testimonial.jpg      <- poster
 *
 *   2. In this file, set that slot's `src` (and `poster`, for video) from
 *      `null` to the public URL of the file you just added:
 *
 *          src: "/showcase/ads/ad-feed-a.jpg",
 *          poster: "/showcase/ugc/ugc-testimonial.jpg",
 *
 *      Any path under `/showcase/...` works — the derived path is only a
 *      suggestion so the placeholder can tell you where to put things.
 *
 * That is the whole procedure. Nothing else in the codebase needs to change.
 * See `public/showcase/README.md` for dimensions, formats and file-size
 * guidance.
 *
 * Adding a NEW slot: append an entry here and reference its id from a group in
 * `HOMEPAGE_SHOWCASE` (or render `<ShowcaseSlot slot={getSlot("id")} />`
 * anywhere). Removing a slot: delete the entry and any group reference.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** What the platform produced. Drives the folder, the badge and the icon. */
export type ShowcaseKind = "ad" | "video" | "ugc" | "drama" | "motion";

/** Aspect ratios the site stages. The string is used verbatim in CSS. */
export type ShowcaseAspect = "1 / 1" | "4 / 5" | "9 / 16" | "16 / 9" | "3 / 2";

export type ShowcaseMedium = "image" | "video";

type KindMeta = {
  /** Sub-folder under `public/showcase/`. */
  folder: string;
  /** Default file extension used by `expectedPath()`. */
  ext: string;
  /** Still or moving picture — decides which component renders the slot. */
  medium: ShowcaseMedium;
  /** Uppercase mono badge printed on the placeholder. */
  badge: string;
};

export const SHOWCASE_KINDS: Record<ShowcaseKind, KindMeta> = {
  ad: { folder: "ads", ext: "jpg", medium: "image", badge: "Ad creative" },
  video: { folder: "video", ext: "mp4", medium: "video", badge: "Video ad" },
  ugc: { folder: "ugc", ext: "mp4", medium: "video", badge: "UGC clip" },
  drama: { folder: "drama", ext: "mp4", medium: "video", badge: "Micro-drama" },
  motion: {
    folder: "motion",
    ext: "mp4",
    medium: "video",
    badge: "Motion graphics",
  },
};

export type ShowcaseSlot = {
  /** Stable, kebab-case. Also the expected filename stem. */
  id: string;
  kind: ShowcaseKind;
  aspect: ShowcaseAspect;
  /** Short human title shown under the frame. */
  title: string;
  /** One line of context shown under the title. */
  note: string;
  /**
   * REQUIRED, and required to stay accurate once real media lands: the
   * accessible description of what the finished asset shows. Used as the
   * image `alt`, and as the accessible name of the video player.
   */
  alt: string;
  /** Intended pixel size, e.g. "1080 x 1350". Printed on the placeholder. */
  dimensions: string;
  /** Accepted formats, e.g. "JPG / WEBP". Printed on the placeholder. */
  formats: string;
  /**
   * Public URL of the real asset once it exists — `/showcase/...`.
   * `null` renders the placeholder.
   */
  src: string | null;
  /**
   * Video only: public URL of the poster frame. Required whenever `src` is
   * set on a video slot — it is the first paint, and the only thing shown
   * under `prefers-reduced-motion: reduce`.
   */
  poster?: string | null;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Where this slot's file is expected to live, as a public URL. */
export function expectedPath(slot: ShowcaseSlot): string {
  const { folder, ext } = SHOWCASE_KINDS[slot.kind];
  return `/showcase/${folder}/${slot.id}.${ext}`;
}

/** Where its poster frame is expected to live (video slots). */
export function expectedPosterPath(slot: ShowcaseSlot): string {
  const { folder } = SHOWCASE_KINDS[slot.kind];
  return `/showcase/${folder}/${slot.id}.jpg`;
}

/** `"4 / 5"` -> `"4:5"`, for the placeholder's spec line. */
export function aspectLabel(aspect: ShowcaseAspect): string {
  return aspect.replace(/\s/g, "").replace("/", ":");
}

export function isVideoSlot(slot: ShowcaseSlot): boolean {
  return SHOWCASE_KINDS[slot.kind].medium === "video";
}

/* ------------------------------------------------------------------ */
/* The slots                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every slot on the site, in one list.
 *
 * | id                  | kind   | aspect | expected file                                  |
 * | ------------------- | ------ | ------ | ---------------------------------------------- |
 * | video-brand-spot    | video  | 16/9   | /showcase/video/video-brand-spot.mp4 (+ .jpg)  |
 * | ad-feed-a           | ad     | 4/5    | /showcase/ads/ad-feed-a.jpg                    |
 * | ad-feed-b           | ad     | 4/5    | /showcase/ads/ad-feed-b.jpg                    |
 * | ad-feed-c           | ad     | 4/5    | /showcase/ads/ad-feed-c.jpg                    |
 * | ugc-testimonial     | ugc    | 9/16   | /showcase/ugc/ugc-testimonial.mp4 (+ .jpg)     |
 * | ugc-unboxing        | ugc    | 9/16   | /showcase/ugc/ugc-unboxing.mp4 (+ .jpg)        |
 * | drama-episode-hook  | drama  | 9/16   | /showcase/drama/drama-episode-hook.mp4 (+ .jpg)|
 * | motion-kinetic-type | motion | 9/16   | /showcase/motion/motion-kinetic-type.mp4 (+.jpg)|
 */
export const SHOWCASE_SLOTS: ShowcaseSlot[] = [
  /* ---- the hero of the section: one landscape video ad -------------- */
  {
    id: "video-brand-spot",
    kind: "video",
    aspect: "16 / 9",
    title: "Brand spot",
    note: "Brief in, finished 20-second spot out — script, shots, voice, cut.",
    alt: "Twenty-second brand video ad produced end to end on marketer.sh.",
    dimensions: "1920 x 1080",
    formats: "MP4 (H.264) + JPG poster",
    src: null,
    poster: null,
  },

  /* ---- static ad creative, one uniform 4:5 row ---------------------- */
  {
    id: "ad-feed-a",
    kind: "ad",
    aspect: "4 / 5",
    title: "Feed ad — offer",
    note: "Portrait paid-social creative, headline and offer baked in.",
    alt: "Portrait social ad creative generated on marketer.sh, showing the product with its headline offer.",
    dimensions: "1080 x 1350",
    formats: "JPG / WEBP",
    src: null,
  },
  {
    id: "ad-feed-b",
    kind: "ad",
    aspect: "4 / 5",
    title: "Feed ad — product",
    note: "Same brief, different angle: product-led variant for testing.",
    alt: "Portrait product-led social ad creative generated on marketer.sh.",
    dimensions: "1080 x 1350",
    formats: "JPG / WEBP",
    src: null,
  },
  {
    id: "ad-feed-c",
    kind: "ad",
    aspect: "4 / 5",
    title: "Feed ad — proof",
    note: "Third variant leading with a customer proof point.",
    alt: "Portrait social ad creative generated on marketer.sh, leading with a customer proof point.",
    dimensions: "1080 x 1350",
    formats: "JPG / WEBP",
    src: null,
  },

  /* ---- the vertical rail: UGC, micro-drama, motion ------------------ */
  {
    id: "ugc-testimonial",
    kind: "ugc",
    aspect: "9 / 16",
    title: "UGC testimonial",
    note: "Synthetic creator piece to camera, captions burned in.",
    alt: "Vertical UGC-style testimonial clip generated on marketer.sh, with burned-in captions.",
    dimensions: "1080 x 1920",
    formats: "MP4 (H.264) + JPG poster",
    src: null,
    poster: null,
  },
  {
    id: "ugc-unboxing",
    kind: "ugc",
    aspect: "9 / 16",
    title: "UGC unboxing",
    note: "Product-in-hand cut for TikTok and Reels.",
    alt: "Vertical UGC-style unboxing clip generated on marketer.sh.",
    dimensions: "1080 x 1920",
    formats: "MP4 (H.264) + JPG poster",
    src: null,
    poster: null,
  },
  {
    id: "drama-episode-hook",
    kind: "drama",
    aspect: "9 / 16",
    title: "Micro-drama hook",
    note: "Episode one's cold open — the three seconds that decide the scroll.",
    alt: "Opening hook of a vertical micro-drama episode produced on marketer.sh.",
    dimensions: "1080 x 1920",
    formats: "MP4 (H.264) + JPG poster",
    src: null,
    poster: null,
  },
  {
    id: "motion-kinetic-type",
    kind: "motion",
    aspect: "9 / 16",
    title: "Motion graphics",
    note: "Kinetic type and brand furniture, rendered to the brand kit.",
    alt: "Vertical kinetic-typography motion graphics clip rendered on marketer.sh.",
    dimensions: "1080 x 1920",
    formats: "MP4 (H.264) + JPG poster",
    src: null,
    poster: null,
  },
];

const BY_ID = new Map(SHOWCASE_SLOTS.map((s) => [s.id, s]));

/** Look a slot up by id. Throws at build time on a typo, rather than at run. */
export function getSlot(id: string): ShowcaseSlot {
  const slot = BY_ID.get(id);
  if (!slot) {
    throw new Error(
      `Unknown showcase slot "${id}". Declared ids: ${SHOWCASE_SLOTS.map((s) => s.id).join(", ")}`,
    );
  }
  return slot;
}

export function getSlots(ids: string[]): ShowcaseSlot[] {
  return ids.map(getSlot);
}

/* ------------------------------------------------------------------ */
/* Where the slots appear                                              */
/* ------------------------------------------------------------------ */

/**
 * The homepage arrangement: a landscape feature, a row of static ads, then a
 * scrollable rail of vertical clips. Reorder or re-point these id lists to
 * change what the homepage shows.
 */
export const HOMEPAGE_SHOWCASE = {
  feature: "video-brand-spot",
  ads: ["ad-feed-a", "ad-feed-b", "ad-feed-c"],
  rail: [
    "ugc-testimonial",
    "ugc-unboxing",
    "drama-episode-hook",
    "motion-kinetic-type",
  ],
} as const;
