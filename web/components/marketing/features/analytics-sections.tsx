import * as React from "react";

import {
  GradientScene,
  Kicker,
  Lede,
  Parallax,
  Reveal,
  Stagger,
  StatStrip,
  TaggedPlaceholder,
  TextReveal,
  VignetteCard,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

import { ProofList } from "./proof-list";
import { VignetteStage } from "./vignette-stage";

/** Matches DisplayHeading's default (level 2, size lg) styling. */
const H2_CLASS =
  "font-display font-semibold tracking-tight text-balance text-zinc-900 text-4xl leading-[1.05] md:text-5xl";

/* ------------------------------------------------------------------ */
/* Learning loop                                                       */
/* ------------------------------------------------------------------ */

export function LoopBand() {
  return (
    <section aria-label="The learning loop" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>The learning loop</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
              Losers teach it as much as winners.
            </TextReveal>
            <Lede className="mt-5">
              Views, watch time, and completion are collected per post. Top
              and bottom performers are attributed to their angles, and
              both verdicts feed the next ideation round.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Winning angles get variations. Losing angles get retired.",
                "Attribution is automatic. No spreadsheet, no Monday review meeting.",
                "The loop compounds: every post makes the next brief sharper.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <Parallax speed={-0.08}>
              <VignetteStage scene="dawn">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                  <TaggedPlaceholder
                    kind="image"
                    label="This week's performers — top and bottom angles"
                    tone="warm"
                  />
                </div>
              </VignetteStage>
            </Parallax>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Spend controls                                                      */
/* ------------------------------------------------------------------ */

export function SpendBand() {
  return (
    <section aria-label="Spend controls" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="sky"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className="lg:order-2">
            <Kicker>Spend controls</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
              Hard caps. Not soft alerts.
            </TextReveal>
            <Lede className="mt-5">
              Every LLM, image, video, and TTS call is metered to a ledger
              as it happens. Caps aren&apos;t a dashboard warning you read the
              next morning, they stop the job.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Per-niche daily caps, so one channel can't eat the budget.",
                "A global cap over everything, plus prepaid credits. No surprise invoice.",
                "When a cap trips, jobs fail closed. Spending stops, mid-pipeline if it must.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center lg:order-1" delay={0.12}>
            <Parallax speed={-0.08}>
              <VignetteStage scene="pearl">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                  <TaggedPlaceholder
                    kind="image"
                    label="Spend cap gauge — per-niche and global caps"
                    tone="sky"
                  />
                </div>
              </VignetteStage>
            </Parallax>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Metrics + ledger moment                                             */
/* ------------------------------------------------------------------ */

export function MetricsMoment() {
  return (
    <section aria-label="Metrics and ledger" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Kicker>One pane, both sides</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4 mx-auto")}>
              What it earned. What it cost.
            </TextReveal>
            <Lede className="mx-auto mt-5">
              Performance and spend live side by side, per post, so you
              always know whether a channel is paying for itself.
            </Lede>
          </Reveal>
          <Stagger
            className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3"
            gap={0.1}
          >
            <VignetteCard
              description="Views, watch time, and completion, attributed and fed to the next ideation round."
              scene="sky"
              title="Post performance"
              vignette={
                <TaggedPlaceholder
                  kind="image"
                  label="Post performance card — views, watch time, completion"
                  tone="sky"
                />
              }
            />
            <VignetteCard
              description="Every call metered as it happens, checked against caps before each step."
              scene="dawn"
              title="Cost ledger"
              vignette={
                <TaggedPlaceholder
                  kind="image"
                  label="Cost ledger card — metered model calls"
                  tone="warm"
                />
              }
            />
            <VignetteCard
              description="The two sides connected: what a post earns feeds the next brief, capped by what it's allowed to cost."
              scene="mist"
              title="The loop, end to end"
              vignette={
                <TaggedPlaceholder
                  kind="illustration"
                  label="Performance-to-spend loop diagram"
                  tone="sky"
                />
              }
            />
          </Stagger>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function AnalyticsStats() {
  return (
    <section
      aria-label="Analytics by the numbers"
      className="mx-auto max-w-6xl px-6 py-24 md:py-28"
    >
      <StatStrip
        stats={[
          { value: 100, suffix: "%", label: "of model calls metered to the ledger" },
          { value: 3, label: "metrics tracked on every post" },
          { value: 0, prefix: "$", label: "allowed past a tripped cap" },
        ]}
      />
    </section>
  );
}
