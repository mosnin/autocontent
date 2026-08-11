import * as React from "react";

import {
  Band,
  CardGrid,
  MediaCard,
  Section,
  SectionHead,
  Stats,
} from "@/components/site/sections";
import { VignetteCard } from "@/components/marketing/system";

import { StageMedia } from "./stage-media";

/* ------------------------------------------------------------------ */
/* Learning loop                                                       */
/* ------------------------------------------------------------------ */

export function LoopBand() {
  return (
    <Band
      bullets={[
        "Winning angles get variations. Losing angles get retired.",
        "Attribution is automatic. No spreadsheet, no Monday review meeting.",
        "The loop compounds: every post makes the next brief sharper.",
      ]}
      eyebrow="The learning loop"
      heading="Losers teach it as much as winners."
      highlight="as much as winners"
      label="The learning loop"
      lede="Views, watch time, and completion are collected per post. Top and bottom performers are attributed to their angles, and both verdicts feed the next ideation round."
      media={
        <MediaCard
          kind="image"
          label="This week's performers — top and bottom angles"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Spend controls                                                      */
/* ------------------------------------------------------------------ */

export function SpendBand() {
  return (
    <Band
      bullets={[
        "Per-niche daily caps, so one channel can't eat the budget.",
        "A global cap over everything, plus prepaid credits. No surprise invoice.",
        "When a cap trips, jobs fail closed. Spending stops, mid-pipeline if it must.",
      ]}
      eyebrow="Spend controls"
      flip
      heading="Hard caps. Not soft alerts."
      highlight="Hard caps."
      label="Spend controls"
      lede="Every LLM, image, video, and TTS call is metered to a ledger as it happens. Caps aren't a dashboard warning you read the next morning, they stop the job."
      media={
        <MediaCard
          kind="image"
          label="Spend cap gauge — per-niche and global caps"
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Metrics + ledger moment                                             */
/* ------------------------------------------------------------------ */

const PANES = [
  {
    title: "Post performance",
    description:
      "Views, watch time, and completion, attributed and fed to the next ideation round.",
    scene: "sky" as const,
    kind: "image" as const,
    label: "Post performance card — views, watch time, completion",
  },
  {
    title: "Cost ledger",
    description:
      "Every call metered as it happens, checked against caps before each step.",
    scene: "dawn" as const,
    kind: "image" as const,
    label: "Cost ledger card — metered model calls",
  },
  {
    title: "The loop, end to end",
    description:
      "The two sides connected: what a post earns feeds the next brief, capped by what it's allowed to cost.",
    scene: "mist" as const,
    kind: "illustration" as const,
    label: "Performance-to-spend loop diagram",
  },
];

export function MetricsMoment() {
  return (
    <Section label="Metrics and ledger">
      <SectionHead
        align="center"
        eyebrow="One pane, both sides"
        heading="What it earned. What it cost."
        highlight="What it cost."
        lede="Performance and spend live side by side, per post, so you always know whether a channel is paying for itself."
      />
      <CardGrid className="os-mt-48">
        {PANES.map((p) => (
          <VignetteCard
            description={p.description}
            key={p.title}
            scene={p.scene}
            title={p.title}
            vignette={<StageMedia kind={p.kind} label={p.label} />}
          />
        ))}
      </CardGrid>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function AnalyticsStats() {
  return (
    <Section label="Analytics by the numbers" size="tight">
      <Stats
        items={[
          { value: "100%", label: "of model calls metered to the ledger" },
          { value: "3", label: "metrics tracked on every post" },
          { value: "$0", label: "allowed past a tripped cap" },
        ]}
      />
    </Section>
  );
}
