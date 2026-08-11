import * as React from "react";

import {
  Band,
  MediaCard,
  Section,
  SectionHead,
  Stats,
} from "@/components/site/sections";
import { VignetteCard, type VignetteScene } from "@/components/marketing/system";
import { CardGrid } from "@/components/site/sections";

import { StageMedia } from "./stage-media";

/* ------------------------------------------------------------------ */
/* Queue moment                                                        */
/* ------------------------------------------------------------------ */

export function QueueMoment() {
  return (
    <Band
      bullets={[
        "Posting windows are set per niche, so posts land when your audience is watching.",
        "Publishing to TikTok, Reels, and Shorts happens from one queue, not three tabs.",
        "Engagement metrics flow back in and steer the next ideation round.",
      ]}
      eyebrow="The queue"
      heading="Renders, schedules, publishes. On its own."
      highlight="On its own."
      label="The publish queue"
      lede="Every video moves through the queue with a status you can read at a glance. Rendering now, scheduled for the next window, published and reporting back."
      media={
        <MediaCard
          kind="image"
          label="Publish queue — render, schedule, publish status"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Character consistency                                               */
/* ------------------------------------------------------------------ */

export function CharacterBand() {
  return (
    <Band
      eyebrow="On-model, every frame"
      extraCopy="So your channel reads like a channel, one presenter your audience recognizes, not a new stranger every post."
      flip
      heading="The same face in video one and video forty."
      highlight="The same face"
      label="Character consistency"
      lede="Each niche gets a character sheet: who fronts the videos, how they look, how they hold the frame. Every gpt-image-1 keyframe is generated against it."
      media={
        <MediaCard
          kind="image"
          label="Character sheet — on-model keyframes across scenes"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Approval gate                                                       */
/* ------------------------------------------------------------------ */

export function ApprovalGateBand() {
  return (
    <Band
      bullets={[
        "Approval on: finished cuts wait in the queue until you say so.",
        "Approval off: QA still gates every cut before it can go out.",
        "Change your mind per niche, any time. The queue adjusts.",
      ]}
      eyebrow="The approval gate"
      heading="Nothing posts without your rules."
      highlight="your rules"
      label="Approval gate"
      lede="The gate is optional, the control is not. Hold every video for review, or let the pipeline run full-auto inside the rules you set. Either way, QA runs before publish."
      media={
        <MediaCard
          kind="image"
          label="Approval gate — hold or auto-publish toggle"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Platforms                                                           */
/* ------------------------------------------------------------------ */

const PLATFORMS: Array<{
  name: string;
  note: string;
  scene: VignetteScene;
  label: string;
}> = [
  {
    name: "TikTok",
    note: "Native 9:16 export, karaoke captions burned in for sound-off scrolls.",
    scene: "mist",
    label: "TikTok short — 9:16 export with karaoke captions",
  },
  {
    name: "Instagram Reels",
    note: "Same cut, Reels-ready. Scheduled into the windows your niche sets.",
    scene: "dawn",
    label: "Reels short — same cut, Reels-ready export",
  },
  {
    name: "YouTube Shorts",
    note: "Published alongside the rest, with per-post metrics flowing back.",
    scene: "sky",
    label: "Shorts short — published with metrics flowing back",
  },
];

export function PlatformRow() {
  return (
    <Section label="Publishing platforms">
      <SectionHead
        eyebrow="Distribution"
        heading="Posted where short-form lives."
        highlight="short-form lives"
        lede="One render, three destinations. Posting windows are set per niche, mornings for coffee, evenings for gaming, and the queue hits them without you."
      />
      <CardGrid className="os-mt-48">
        {PLATFORMS.map((p) => (
          <VignetteCard
            description={p.note}
            key={p.name}
            scene={p.scene}
            title={p.name}
            vignette={<StageMedia kind="video" label={p.label} />}
          />
        ))}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function VideoStats() {
  return (
    <Section label="Video by the numbers" size="tight">
      <Stats
        items={[
          { value: "10", label: "stages from brief to post" },
          { value: "$0.50", label: "typical cost of a finished short" },
          { value: "3", label: "platforms from one render" },
        ]}
      />
    </Section>
  );
}
