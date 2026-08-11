import * as React from "react";

import { Band, MediaCard } from "@/components/site/sections";

type BandSpec = {
  id: string;
  kicker: string;
  title: string;
  highlight: string;
  lede: string;
  bullets: [string, string, string];
  href: string;
  linkLabel: string;
  media: { kind: "image" | "illustration" | "video"; label: string };
  flip?: boolean;
};

const BANDS: BandSpec[] = [
  {
    id: "video",
    kicker: "Short-form video",
    title: "A finished short from a single brief.",
    highlight: "single brief",
    lede: "Ideation, a scene-by-scene script, keyframes, animation, voice, music, edit, captions, QA, publish. Ten stages, no hand-offs, no timeline to babysit.",
    bullets: [
      "Keyframes stay on-model. Every frame is generated against a per-niche character sheet.",
      "Voiceover with steerable delivery, music ducked underneath, word-level karaoke captions.",
      "Posts land on TikTok, Reels, and Shorts in the posting windows you set per niche.",
    ],
    href: "/features/video",
    linkLabel: "Explore video",
    media: {
      kind: "image",
      label: "Publish queue — render, schedule, publish status",
    },
  },
  {
    id: "articles",
    kicker: "Articles & SEO",
    title: "Articles built to rank, not to fill a blog.",
    highlight: "to rank",
    lede: "Every article starts with live Exa research of what already ranks. Then a structured outline, sections written in parallel, and a QA score before anything ships.",
    bullets: [
      "Topics are deduped against your recent posts. It never writes the same article twice.",
      "One H1, five to ten H2s, sections drafted in parallel under E-E-A-T prose rules.",
      "SEO metadata, JSON-LD for Article and FAQPage, internal links, and an editorial hero image.",
    ],
    href: "/features/articles",
    linkLabel: "Explore articles",
    media: {
      kind: "image",
      label: "Article SEO card — metadata and schema",
    },
    flip: true,
  },
  {
    id: "automation",
    kicker: "Automation & agents",
    title: "Your agents run the whole thing.",
    highlight: "Your agents",
    lede: "REST API, a typed Python SDK, the marketer CLI, and an MCP server with cost-aware tool descriptions. Everything a person can do, an agent can do.",
    bullets: [
      "Agents create niches, enqueue videos, generate articles, and check spend.",
      "Scheduled posting windows fire on their own. Nobody has to be at the keyboard.",
      "Retry and reaping keep the queue honest when a worker dies mid-job.",
    ],
    href: "/features/automation",
    linkLabel: "Explore automation",
    media: {
      kind: "image",
      label: "Agent chat — MCP tool call to shipped video",
    },
  },
  {
    id: "analytics",
    kicker: "Analytics & spend",
    title: "It learns what works. It never overspends.",
    highlight: "never overspends",
    lede: "Views, watch time, and completion flow back into the next ideation round. And every model call is metered against caps that fail closed, not open.",
    bullets: [
      "Top and bottom performers are attributed, so winning angles repeat and losers retire.",
      "Every LLM, image, video, and TTS call is metered to a ledger as it happens.",
      "Per-niche daily caps, a global cap, and prepaid credits. A tripped cap stops the job.",
    ],
    href: "/features/analytics",
    linkLabel: "Explore analytics",
    media: {
      kind: "image",
      label: "Analytics dashboard — performance metrics and spend cap gauge",
    },
    flip: true,
  },
];

/**
 * The four alternating feature bands on the /features hub: video, articles,
 * automation, analytics. Each links to its subpage.
 */
export function HubBands() {
  return (
    <>
      {BANDS.map((band) => (
        <Band
          bullets={band.bullets}
          cta={{ label: band.linkLabel, href: band.href }}
          eyebrow={band.kicker}
          flip={band.flip}
          heading={band.title}
          highlight={band.highlight}
          id={band.id}
          key={band.id}
          label={band.kicker}
          lede={band.lede}
          media={
            <MediaCard kind={band.media.kind} label={band.media.label} />
          }
        />
      ))}
    </>
  );
}
