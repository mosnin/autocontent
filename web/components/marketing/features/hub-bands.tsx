import * as React from "react";

import {
  AnalyticsLoopIllustration,
  ArticleFlowIllustration,
  AutomationOrbitIllustration,
  VideoPipelineIllustration,
} from "@/components/marketing/illustrations";
import {
  CtaPill,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  TextReveal,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

import { ProofList } from "./proof-list";

type Band = {
  id: string;
  kicker: string;
  title: string;
  lede: string;
  bullets: [string, string, string];
  href: string;
  linkLabel: string;
  illustration: React.ReactNode;
  scene: "white" | "pearl" | "sky";
  flip?: boolean;
};

const BANDS: Band[] = [
  {
    id: "video",
    kicker: "Short-form video",
    title: "A finished short from a single brief.",
    lede: "Ideation, a scene-by-scene script, keyframes, animation, voice, music, edit, captions, QA, publish. Ten stages, no hand-offs, no timeline to babysit.",
    bullets: [
      "Keyframes stay on-model. Every frame is generated against a per-niche character sheet.",
      "Voiceover with steerable delivery, music ducked underneath, word-level karaoke captions.",
      "Posts land on TikTok, Reels, and Shorts in the posting windows you set per niche.",
    ],
    href: "/features/video",
    linkLabel: "Explore video",
    illustration: <VideoPipelineIllustration />,
    scene: "white",
  },
  {
    id: "articles",
    kicker: "Articles & SEO",
    title: "Articles built to rank, not to fill a blog.",
    lede: "Every article starts with live Exa research of what already ranks. Then a structured outline, sections written in parallel, and a QA score before anything ships.",
    bullets: [
      "Topics are deduped against your recent posts. It never writes the same article twice.",
      "One H1, five to ten H2s, sections drafted in parallel under E-E-A-T prose rules.",
      "SEO metadata, JSON-LD for Article and FAQPage, internal links, and an editorial hero image.",
    ],
    href: "/features/articles",
    linkLabel: "Explore articles",
    illustration: <ArticleFlowIllustration />,
    scene: "pearl",
    flip: true,
  },
  {
    id: "automation",
    kicker: "Automation & agents",
    title: "Your agents run the whole thing.",
    lede: "REST API, a typed Python SDK, the marketer CLI, and an MCP server with cost-aware tool descriptions. Everything a person can do, an agent can do.",
    bullets: [
      "Agents create niches, enqueue videos, generate articles, and check spend.",
      "Scheduled posting windows fire on their own. Nobody has to be at the keyboard.",
      "Retry and reaping keep the queue honest when a worker dies mid-job.",
    ],
    href: "/features/automation",
    linkLabel: "Explore automation",
    illustration: <AutomationOrbitIllustration />,
    scene: "white",
  },
  {
    id: "analytics",
    kicker: "Analytics & spend",
    title: "It learns what works. It never overspends.",
    lede: "Views, watch time, and completion flow back into the next ideation round. And every model call is metered against caps that fail closed, not open.",
    bullets: [
      "Top and bottom performers are attributed, so winning angles repeat and losers retire.",
      "Every LLM, image, video, and TTS call is metered to a ledger as it happens.",
      "Per-niche daily caps, a global cap, and prepaid credits. A tripped cap stops the job.",
    ],
    href: "/features/analytics",
    linkLabel: "Explore analytics",
    illustration: <AnalyticsLoopIllustration />,
    scene: "sky",
    flip: true,
  },
];

function BandPanel({ band }: { band: Band }) {
  const inner = (
    <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
      <Reveal className={cn(band.flip && "lg:order-2")}>
        <Kicker>{band.kicker}</Kicker>
        <TextReveal
          as="h2"
          className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
        >
          {band.title}
        </TextReveal>
        <Lede className="mt-5">{band.lede}</Lede>
        <ProofList className="mt-8" items={band.bullets} />
        <CtaPill className="mt-9" href={band.href} variant="secondary">
          {band.linkLabel}
        </CtaPill>
      </Reveal>
      <Reveal className={cn(band.flip && "lg:order-1")} delay={0.08}>
        {band.illustration}
      </Reveal>
    </div>
  );

  if (band.scene === "white") {
    return (
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        {inner}
      </div>
    );
  }

  return (
    <GradientScene
      className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
      variant={band.scene}
    >
      {inner}
    </GradientScene>
  );
}

/**
 * The four large alternating feature bands on the /features hub: video,
 * articles, automation, analytics. Each links to its subpage.
 */
export function HubBands() {
  return (
    <>
      {BANDS.map((band) => (
        <section
          aria-label={band.kicker}
          className="px-4 pt-6 md:px-6"
          key={band.id}
        >
          <BandPanel band={band} />
        </section>
      ))}
    </>
  );
}
