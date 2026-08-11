import * as React from "react";

import {
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  Stagger,
  StatStrip,
  TaggedPlaceholder,
  TextReveal,
  VignetteCard,
  type VignetteScene,
} from "@/components/marketing/system";

import { ProofList } from "./proof-list";
import { VignetteStage } from "./vignette-stage";

/* ------------------------------------------------------------------ */
/* Queue moment                                                        */
/* ------------------------------------------------------------------ */

export function QueueMoment() {
  return (
    <section aria-label="The publish queue" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>The queue</Kicker>
            <TextReveal
              as="h2"
              className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
            >
              Renders, schedules, publishes. On its own.
            </TextReveal>
            <Lede className="mt-5">
              Every video moves through the queue with a status you can read
              at a glance. Rendering now, scheduled for the next window,
              published and reporting back.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Posting windows are set per niche, so posts land when your audience is watching.",
                "Publishing to TikTok, Reels, and Shorts happens from one queue, not three tabs.",
                "Engagement metrics flow back in and steer the next ideation round.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <VignetteStage scene="sky">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                <TaggedPlaceholder
                  kind="image"
                  label="Publish queue — render, schedule, publish status"
                  tone="sky"
                />
              </div>
            </VignetteStage>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Character consistency                                               */
/* ------------------------------------------------------------------ */

export function CharacterBand() {
  return (
    <section aria-label="Character consistency" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className="flex justify-center lg:order-1">
            <div className="aspect-[4/3] w-full max-w-sm overflow-hidden rounded-2xl">
              <TaggedPlaceholder
                kind="image"
                label="Character sheet — on-model keyframes across scenes"
                tone="warm"
              />
            </div>
          </Reveal>
          <Reveal className="lg:order-2" delay={0.12}>
            <Kicker>On-model, every frame</Kicker>
            <TextReveal
              as="h2"
              className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
            >
              The same face in video one and video forty.
            </TextReveal>
            <Lede className="mt-5">
              Each niche gets a character sheet: who fronts the videos, how
              they look, how they hold the frame. Every gpt-image-1 keyframe
              is generated against it.
            </Lede>
            <Lede className="mt-4">
              So your channel reads like a channel, one presenter your
              audience recognizes, not a new stranger every post.
            </Lede>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Approval gate                                                       */
/* ------------------------------------------------------------------ */

export function ApprovalGateBand() {
  return (
    <section aria-label="Approval gate" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="sky"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>The approval gate</Kicker>
            <TextReveal
              as="h2"
              className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
            >
              Nothing posts without your rules.
            </TextReveal>
            <Lede className="mt-5">
              The gate is optional, the control is not. Hold every video for
              review, or let the pipeline run full-auto inside the rules you
              set. Either way, QA runs before publish.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Approval on: finished cuts wait in the queue until you say so.",
                "Approval off: QA still gates every cut before it can go out.",
                "Change your mind per niche, any time. The queue adjusts.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <VignetteStage scene="dawn">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                <TaggedPlaceholder
                  kind="image"
                  label="Approval gate — hold or auto-publish toggle"
                  tone="rose"
                />
              </div>
            </VignetteStage>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Platforms                                                           */
/* ------------------------------------------------------------------ */

const PLATFORMS: Array<{
  name: string;
  note: string;
  scene: VignetteScene;
  tone: "warm" | "sky" | "violet" | "slate" | "rose";
  label: string;
}> = [
  {
    name: "TikTok",
    note: "Native 9:16 export, karaoke captions burned in for sound-off scrolls.",
    scene: "mist",
    tone: "violet",
    label: "TikTok short — 9:16 export with karaoke captions",
  },
  {
    name: "Instagram Reels",
    note: "Same cut, Reels-ready. Scheduled into the windows your niche sets.",
    scene: "dawn",
    tone: "rose",
    label: "Reels short — same cut, Reels-ready export",
  },
  {
    name: "YouTube Shorts",
    note: "Published alongside the rest, with per-post metrics flowing back.",
    scene: "sky",
    tone: "sky",
    label: "Shorts short — published with metrics flowing back",
  },
];

export function PlatformRow() {
  return (
    <section
      aria-label="Publishing platforms"
      className="mx-auto max-w-6xl px-6 py-24 md:py-32"
    >
      <Reveal className="max-w-2xl">
        <Kicker>Distribution</Kicker>
        <TextReveal
          as="h2"
          className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
        >
          Posted where short-form lives.
        </TextReveal>
        <Lede className="mt-5">
          One render, three destinations. Posting windows are set per niche,
          mornings for coffee, evenings for gaming, and the queue hits them
          without you.
        </Lede>
      </Reveal>
      <Stagger className="mt-12 grid gap-6 md:grid-cols-3" gap={0.08}>
        {PLATFORMS.map((p) => (
          <VignetteCard
            description={p.note}
            key={p.name}
            scene={p.scene}
            title={p.name}
            vignette={
              <TaggedPlaceholder kind="video" label={p.label} tone={p.tone} />
            }
          />
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function VideoStats() {
  return (
    <section
      aria-label="Video by the numbers"
      className="mx-auto max-w-6xl px-6 pb-24 md:pb-28"
    >
      <StatStrip
        stats={[
          { value: 10, label: "stages from brief to post" },
          {
            value: 0.5,
            prefix: "$",
            decimals: 2,
            label: "typical cost of a finished short",
          },
          { value: 3, label: "platforms from one render" },
        ]}
      />
    </section>
  );
}
