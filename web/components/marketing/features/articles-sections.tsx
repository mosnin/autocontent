import * as React from "react";

import {
  GlassPanel,
  GradientScene,
  Kicker,
  Lede,
  Parallax,
  Reveal,
  Stagger,
  TaggedPlaceholder,
  TextReveal,
  warmBg,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

import { ProofList } from "./proof-list";
import { VignetteStage } from "./vignette-stage";

/** Matches DisplayHeading's default (level 2, size lg) styling. */
const H2_CLASS =
  "font-display font-semibold tracking-tight text-balance text-zinc-900 text-4xl leading-[1.05] md:text-5xl";

/* ------------------------------------------------------------------ */
/* SERP research                                                       */
/* ------------------------------------------------------------------ */

export function SerpBand() {
  return (
    <section aria-label="SERP research" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>Research first</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
              It reads the results page before writing one.
            </TextReveal>
            <Lede className="mt-5">
              Each topic is picked and deduped against your recent posts, so
              nothing repeats. Then Exa pulls what currently ranks, and the
              pipeline studies the angles, the depth, and the gaps.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Live SERP research on every article, not a stale keyword list.",
                "The outline targets what the top results miss, not what they already cover.",
                "Deduped against your archive. The same article never ships twice.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <VignetteStage scene="sky">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                <TaggedPlaceholder
                  kind="image"
                  label="SERP research scan — ranked results for a topic"
                  tone="sky"
                />
              </div>
            </VignetteStage>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Outline → parallel writing                                          */
/* ------------------------------------------------------------------ */

export function OutlineBand() {
  return (
    <section aria-label="Outline and writing" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className="lg:order-2">
            <Kicker>Structure, then speed</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
              One outline. Sections written in parallel.
            </TextReveal>
            <Lede className="mt-5">
              The research becomes a structured outline: one H1, five to ten
              H2s, each with a job to do. Then every section is drafted at
              the same time, under E-E-A-T prose rules.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "First-hand, specific prose. Numbers over adjectives, no filler paragraphs.",
                "Parallel drafting means a full article in minutes, not an afternoon.",
                "Every section knows the outline, so the piece reads as one argument.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center lg:order-1" delay={0.12}>
            <Parallax speed={-0.1}>
              <VignetteStage scene="pearl">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                  <TaggedPlaceholder
                    kind="illustration"
                    label="Outline structure — H1, H2 sections drafted in parallel"
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
/* SEO metadata card                                                   */
/* ------------------------------------------------------------------ */

export function MetadataBand() {
  return (
    <section aria-label="SEO metadata" className="px-4 pt-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="sky"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>Ship-ready</Kicker>
            <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
              Metadata handled. Schema included.
            </TextReveal>
            <Lede className="mt-5">
              Every article leaves the pipeline with a title, slug, meta
              description, and keywords, plus JSON-LD for Article and
              FAQPage so search engines read it the way you meant it.
            </Lede>
            <ProofList
              className="mt-8"
              items={[
                "Internal-link suggestions connect the new piece to your existing posts.",
                "An editorial hero image is generated to match the piece, not a stock photo.",
                "Paste-ready output: prose, metadata, schema, and links in one payload.",
              ]}
            />
          </Reveal>
          <Reveal className="flex justify-center" delay={0.12}>
            <VignetteStage className="max-w-lg" scene="pearl">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl">
                <TaggedPlaceholder
                  kind="image"
                  label="SEO metadata card — title, slug, schema tags"
                  tone="warm"
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
/* QA scores                                                           */
/* ------------------------------------------------------------------ */

const QA_SCORES = [
  {
    label: "Keyword density",
    score: 92,
    note: "On target without stuffing.",
  },
  {
    label: "E-E-A-T",
    score: 88,
    note: "Experience and expertise signals present.",
  },
  {
    label: "Readability",
    score: 95,
    note: "Short sentences, clean structure.",
  },
];

export function QaBand() {
  return (
    <section
      aria-label="Quality scoring"
      className="mx-auto max-w-6xl px-6 py-24 md:py-32"
    >
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
        <Reveal className="max-w-2xl">
          <Kicker>Quality gate</Kicker>
          <TextReveal as="h2" className={cn(H2_CLASS, "mt-4")}>
            Scored before it ships.
          </TextReveal>
          <Lede className="mt-5">
            Every draft is scored on keyword density, E-E-A-T, and
            readability. Fall short and it gets one corrective rewrite, then
            it&apos;s re-scored. Then it ships, or it doesn&apos;t.
          </Lede>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="aspect-[4/3] overflow-hidden rounded-[1.75rem]">
            <TaggedPlaceholder
              kind="illustration"
              label="QA gate diagram — draft, score, rewrite, ship"
              tone="violet"
            />
          </div>
        </Reveal>
      </div>
      <Stagger className="mt-12 grid gap-6 md:grid-cols-3" gap={0.08}>
        {QA_SCORES.map((q) => (
          <GlassPanel className="p-6" key={q.label}>
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-zinc-600">{q.label}</p>
              <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-zinc-900">
                {q.score}
                <span className="text-base font-medium text-zinc-400">
                  /100
                </span>
              </p>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-900/[0.06]">
              <div
                className={cn("h-full rounded-full", warmBg)}
                style={{ width: `${q.score}%` }}
              />
            </div>
            <p className="mt-3 text-[13px] text-zinc-500">{q.note}</p>
          </GlassPanel>
        ))}
      </Stagger>
      <Reveal delay={0.15}>
        <p className="mt-8 text-sm text-zinc-500">
          One corrective rewrite, maximum. If a piece can&apos;t clear the bar
          in two passes, it doesn&apos;t go out under your name.
        </p>
      </Reveal>
    </section>
  );
}
