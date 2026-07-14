import * as React from "react";

import { SpendGuardIllustration } from "@/components/marketing/illustrations";
import {
  DisplayHeading,
  GlassPanel,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  Stagger,
  StatStrip,
  VignetteCard,
  warmChip,
} from "@/components/marketing/system";
import {
  CreditsVignette,
  MetricsVignette,
} from "@/components/marketing/vignettes";

import { ProofList } from "./proof-list";

/* ------------------------------------------------------------------ */
/* Learning loop                                                       */
/* ------------------------------------------------------------------ */

function PerformersCard() {
  return (
    <GlassPanel className="w-full max-w-sm p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-zinc-900">This week</p>
        <span className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-500">
          home-espresso
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        <li className="rounded-xl border border-amber-600/15 bg-amber-50/50 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-medium text-zinc-800">
              Dial in espresso in 60 seconds
            </p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${warmChip}`}
            >
              top performer
            </span>
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-zinc-500">
            48.2K views · 71% completion · more like this
          </p>
        </li>
        <li className="rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[13px] font-medium text-zinc-800">
              The history of the portafilter
            </p>
            <span className="shrink-0 rounded-full border border-zinc-900/10 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
              bottom
            </span>
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-zinc-500">
            900 views · 12% completion · angle retired
          </p>
        </li>
      </ul>
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand/20 bg-brand/[0.05] px-3.5 py-2.5">
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand" />
        <p className="text-[12px] leading-snug text-zinc-600">
          Next ideation round: more fast how-tos, no more history explainers.
        </p>
      </div>
    </GlassPanel>
  );
}

export function LoopBand() {
  return (
    <section aria-label="The learning loop" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>The learning loop</Kicker>
            <DisplayHeading className="mt-4">
              Losers teach it as much as winners.
            </DisplayHeading>
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
            <PerformersCard />
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
            <DisplayHeading className="mt-4">
              Hard caps. Not soft alerts.
            </DisplayHeading>
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
          <Reveal className="lg:order-1" delay={0.12}>
            <SpendGuardIllustration />
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
            <DisplayHeading className="mt-4">
              What it earned. What it cost.
            </DisplayHeading>
            <Lede className="mx-auto mt-5">
              Performance and spend live side by side, per post, so you
              always know whether a channel is paying for itself.
            </Lede>
          </Reveal>
          <Stagger
            className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2"
            gap={0.1}
          >
            <VignetteCard
              description="Views, watch time, and completion, attributed and fed to the next ideation round."
              scene="sky"
              title="Post performance"
              vignette={<MetricsVignette />}
            />
            <VignetteCard
              description="Every call metered as it happens, checked against caps before each step."
              scene="dawn"
              title="Cost ledger"
              vignette={<CreditsVignette />}
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
