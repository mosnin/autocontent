// The media-slot registry: every swappable image surface on the marketing
// site and the dashboards, by stable id. The admin Media manager
// (/admin/media) uploads against these ids; <MediaSlot> renders the
// uploaded image or a rich duotone placeholder until one exists.
//
// Pure + client-safe (no server imports).

export type MediaTone = "warm" | "sky" | "violet" | "slate" | "rose";

export interface MediaSlotDef {
  id: string;
  label: string;
  /** Grouping for the admin manager. */
  group: "Marketing site" | "Dashboards";
  /** Placeholder gradient family while empty. */
  tone: MediaTone;
  /** Human hint for the ideal upload. */
  hint: string;
}

export const MEDIA_SLOTS: MediaSlotDef[] = [
  // ---------------------------------------------------------- marketing
  {
    id: "mk-hero",
    label: "Homepage hero — app screenshot",
    group: "Marketing site",
    tone: "warm",
    hint: "~1560×1200 PNG, Studio queue with agent sidebar",
  },
  {
    id: "mk-agents",
    label: "Agents band — hero photo",
    group: "Marketing site",
    tone: "violet",
    hint: "~2100×1000 JPG, person delegating to an agent",
  },
  {
    id: "mk-converged-studio",
    label: "Converged grid — Studio card",
    group: "Marketing site",
    tone: "sky",
    hint: "~640×440 PNG, video queue screenshot",
  },
  {
    id: "mk-converged-press",
    label: "Converged grid — Press card",
    group: "Marketing site",
    tone: "violet",
    hint: "~640×440 PNG, article SEO panel",
  },
  {
    id: "mk-converged-agents",
    label: "Converged grid — Agents card",
    group: "Marketing site",
    tone: "rose",
    hint: "~640×440 PNG, agent chat",
  },
  {
    id: "mk-converged-ads",
    label: "Converged grid — Ads card",
    group: "Marketing site",
    tone: "warm",
    hint: "~640×440 PNG, budget guardrails",
  },
  {
    id: "mk-testimonial-1",
    label: "Testimonial portrait 1 (creator)",
    group: "Marketing site",
    tone: "warm",
    hint: "~800×1000 JPG portrait",
  },
  {
    id: "mk-testimonial-2",
    label: "Testimonial portrait 2 (agency)",
    group: "Marketing site",
    tone: "sky",
    hint: "~800×1000 JPG portrait",
  },
  {
    id: "mk-testimonial-3",
    label: "Testimonial portrait 3 (SaaS)",
    group: "Marketing site",
    tone: "violet",
    hint: "~800×1000 JPG portrait",
  },
  {
    id: "mk-testimonial-4",
    label: "Testimonial portrait 4 (ecommerce)",
    group: "Marketing site",
    tone: "rose",
    hint: "~800×1000 JPG portrait",
  },
  // ---------------------------------------------------------- dashboards
  {
    id: "dash-home-campaigns",
    label: "Home hub — Campaigns banner",
    group: "Dashboards",
    tone: "warm",
    hint: "~1200×700 PNG (optional; vignette shows otherwise)",
  },
  {
    id: "dash-home-content",
    label: "Home hub — Content banner",
    group: "Dashboards",
    tone: "sky",
    hint: "~1200×700 PNG (optional; vignette shows otherwise)",
  },
  {
    id: "dash-home-seo",
    label: "Home hub — SEO card",
    group: "Dashboards",
    tone: "violet",
    hint: "~800×500 PNG (optional)",
  },
  {
    id: "dash-home-ads",
    label: "Home hub — Ads card",
    group: "Dashboards",
    tone: "warm",
    hint: "~800×500 PNG (optional)",
  },
  {
    id: "dash-home-suite",
    label: "Home hub — Suite card",
    group: "Dashboards",
    tone: "slate",
    hint: "~800×500 PNG (optional)",
  },
];

export function mediaSlotById(id: string): MediaSlotDef | undefined {
  return MEDIA_SLOTS.find((s) => s.id === id);
}

/** URL an uploaded slot image is served from (versioned to bust caches). */
export function mediaFileUrl(id: string, version?: number | string) {
  return `/api/media/file/${id}${version ? `?v=${version}` : ""}`;
}
