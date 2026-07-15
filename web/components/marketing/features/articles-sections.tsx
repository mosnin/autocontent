import * as React from "react";

import { ArticleFlowIllustration } from "@/components/marketing/illustrations";
import {
  DisplayHeading,
  GlassPanel,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  Stagger,
  warmBg,
  warmChip,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

import { ProofList } from "./proof-list";
import { VignetteStage } from "./vignette-stage";

/* ------------------------------------------------------------------ */
/* SERP research                                                       */
/* ------------------------------------------------------------------ */

const SERP_ROWS = [
  {
    rank: 1,
    title: "Best espresso machines of 2026",
    domain: "wirecutter.com",
    chip: "hands-on",
  },
  {
    rank: 2,
    title: "9 best home espresso machines",
    domain: "goodhousekeeping.com",
    chip: "listicle",
  },
  {
    rank: 3,
    title: "Espresso machine buying guide",
    domain: "seriouseats.com",
    chip: "guide",
  },
];

function SerpCard() {
  return (
    <GlassPanel className="w-full max-w-sm p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-zinc-900">SERP scan</p>
        <span className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 font-mono text-[11px] text-zinc-500">
          exa
        </span>
      </div>
      <p className="mt-1 text-[12px] text-zinc-400">
        &ldquo;best home espresso machine&rdquo;
      </p>
      <ul className="mt-4 space-y-2">
        {SERP_ROWS.map((row) => (
          <li
            className="flex items-center gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-2.5"
            key={row.rank}
          >
            <span className="font-mono text-xs tabular-nums text-zinc-400">
              {row.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-zinc-800">
                {row.title}
              </p>
              <p className="text-[11px] text-zinc-400">{row.domain}</p>
            </div>
            <span className="rounded-full bg-zinc-900/[0.05] px-2 py-0.5 text-[10px] font-medium text-zinc-500">
              {row.chip}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand/20 bg-brand/[0.05] px-3.5 py-2.5">
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand" />
        <p className="text-[12px] leading-snug text-zinc-600">
          Gap: no sub-$800 head-to-head. That&apos;s the angle.
        </p>
      </div>
    </GlassPanel>
  );
}

export function SerpBand() {
  return (
    <section aria-label="SERP research" className="px-4 pt-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>Research first</Kicker>
            <DisplayHeading className="mt-4">
              It reads the results page before writing one.
            </DisplayHeading>
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
              <SerpCard />
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
            <DisplayHeading className="mt-4">
              One outline. Sections written in parallel.
            </DisplayHeading>
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
          <Reveal className="lg:order-1" delay={0.12}>
            <ArticleFlowIllustration />
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* SEO metadata card                                                   */
/* ------------------------------------------------------------------ */

function MetaField({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-[13px] leading-snug text-zinc-700",
          mono && "font-mono text-[12px]",
        )}
      >
        {children}
      </p>
    </div>
  );
}

function MetadataCard() {
  return (
    <GlassPanel className="w-full max-w-md p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-zinc-900">SEO metadata</p>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            warmChip,
          )}
        >
          generated
        </span>
      </div>
      <div className="mt-4 space-y-2">
        <MetaField label="Title">
          Best Home Espresso Machines Under $800, Tested
        </MetaField>
        <MetaField label="Slug" mono>
          /blog/best-home-espresso-machines-under-800
        </MetaField>
        <MetaField label="Meta description">
          We pulled 400 shots on 9 machines under $800. Three earn the
          counter space, and one beats machines twice its price.
        </MetaField>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["best espresso machine", "under $800", "home barista"].map((kw) => (
          <span
            className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 text-[11px] font-medium text-zinc-500"
            key={kw}
          >
            {kw}
          </span>
        ))}
        {["JSON-LD: Article", "JSON-LD: FAQPage"].map((chip) => (
          <span
            className="rounded-full border border-sky-600/15 bg-sky-50/80 px-2.5 py-1 font-mono text-[11px] font-medium text-sky-700"
            key={chip}
          >
            {chip}
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}

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
            <DisplayHeading className="mt-4">
              Metadata handled. Schema included.
            </DisplayHeading>
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
              <MetadataCard />
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
      <Reveal className="max-w-2xl">
        <Kicker>Quality gate</Kicker>
        <DisplayHeading className="mt-4">Scored before it ships.</DisplayHeading>
        <Lede className="mt-5">
          Every draft is scored on keyword density, E-E-A-T, and
          readability. Fall short and it gets one corrective rewrite, then
          it&apos;s re-scored. Then it ships, or it doesn&apos;t.
        </Lede>
      </Reveal>
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
