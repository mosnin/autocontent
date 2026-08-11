import * as React from "react";

import {
  GradientScene,
  Kicker,
  Lede,
  Parallax,
  Reveal,
  Stagger,
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
/* Surface cards: API / SDK / CLI / MCP                                */
/* ------------------------------------------------------------------ */

export function SurfaceCards() {
  return (
    <section
      aria-label="Agent surfaces"
      className="mx-auto max-w-6xl px-6 py-24 md:py-32"
    >
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
        <Reveal className="max-w-2xl">
          <Kicker>Four surfaces, one platform</Kicker>
          <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
            Create a niche. Enqueue a video. Check the spend.
          </TextReveal>
          <Lede className="mt-5">
            The same three calls, from whichever surface fits the stack:
            REST, the Python SDK, the CLI, or MCP.
          </Lede>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="aspect-[4/3] overflow-hidden rounded-[1.75rem]">
            <TaggedPlaceholder
              kind="illustration"
              label="Surface map — API, SDK, CLI, MCP"
              tone="warm"
            />
          </div>
        </Reveal>
      </div>

      <Stagger className="mt-12 grid gap-6 md:grid-cols-2" gap={0.08}>
        <VignetteCard
          description="Every pipeline behind plain endpoints. Enqueue a video, poll a job, read the ledger."
          kicker="REST"
          scene="sky"
          title="API"
          vignette={
            <TaggedPlaceholder
              kind="image"
              label="REST call — enqueue endpoint request and response"
              tone="sky"
            />
          }
        />

        <VignetteCard
          description="Typed end to end. Your editor knows the request shapes before the docs do."
          kicker="Python"
          scene="pearl"
          title="SDK"
          vignette={
            <TaggedPlaceholder
              kind="image"
              label="Python SDK snippet — enqueue a video"
              tone="slate"
            />
          }
        />

        <VignetteCard
          description="The whole platform from a shell. Scriptable, cron-able, agent-runnable."
          kicker="CLI"
          scene="dusk"
          title="marketer"
          vignette={
            <TaggedPlaceholder
              kind="image"
              label="CLI session — marketer command output"
              tone="violet"
            />
          }
        />

        <VignetteCard
          description="Tool descriptions carry cost estimates, so an agent knows the price before it calls."
          kicker="MCP"
          scene="mist"
          title="MCP server"
          vignette={
            <TaggedPlaceholder
              kind="image"
              label="MCP tool call — cost-aware tool description"
              tone="rose"
            />
          }
        />
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Scheduled windows                                                   */
/* ------------------------------------------------------------------ */

export function WindowsBand() {
  return (
    <section aria-label="Scheduled windows" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>Autopilot</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
              The schedule runs itself.
            </TextReveal>
            <Lede className="mt-5">
              Each niche has posting windows. When one opens, the pipeline
              produces, checks, and publishes without anyone at the
              keyboard. Your approval gate, if you set one, still applies.
            </Lede>
            <div className="mt-7 flex flex-wrap gap-2">
              {["Mon-Fri 9:00", "Daily 12:30", "Weekends 18:00"].map((w) => (
                <span
                  className="rounded-full border border-zinc-900/10 bg-white/80 px-3.5 py-1.5 font-mono text-xs font-medium text-zinc-600"
                  key={w}
                >
                  {w}
                </span>
              ))}
            </div>
            <ProofList
              className="mt-8"
              items={[
                "Windows are per niche, tuned to when that audience actually watches.",
                "Agents can add or move windows through any surface.",
                "Caps are checked before each run, so autopilot can't outspend you.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <Parallax speed={-0.1}>
              <VignetteStage scene="dusk">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                  <TaggedPlaceholder
                    kind="illustration"
                    label="Posting schedule — per-niche windows"
                    tone="violet"
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
/* Reliability                                                         */
/* ------------------------------------------------------------------ */

export function ReliabilityBand() {
  return (
    <section aria-label="Reliability" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className="flex justify-center lg:order-1">
            <div className="aspect-[4/3] w-full max-w-sm overflow-hidden rounded-2xl">
              <TaggedPlaceholder
                kind="image"
                label="Queue health panel — retries and reaping status"
                tone="slate"
              />
            </div>
          </Reveal>
          <Reveal className="lg:order-2" delay={0.12}>
            <Kicker>Reliability</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
              Retry and reaping keep the queue honest.
            </TextReveal>
            <Lede className="mt-5">
              Failed steps retry. Jobs orphaned by a dead worker get reaped
              and requeued. And when a spend cap trips, the job fails
              closed instead of quietly burning money.
            </Lede>
            <Lede className="mt-4">
              The result: a queue you can leave alone, because it never
              needs a human to unstick it.
            </Lede>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
