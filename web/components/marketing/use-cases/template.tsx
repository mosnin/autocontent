"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  CtaPill,
  DisplayHeading,
  EASE,
  Kicker,
  Lede,
  Magnetic,
  Reveal,
  Stagger,
  StatStrip,
  TaggedPlaceholder,
  TextReveal,
  type Stat,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";
import { UseCaseScene, type SceneName } from "./scene";

/** Placeholder tones the tagged-placeholder kit supports. */
type PlaceholderTone = "warm" | "sky" | "violet" | "slate" | "rose";

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function FadeUp({
  children,
  delay,
  className,
}: {
  children: React.ReactNode;
  delay: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  // Always mount the motion element: the plain-div branch leaves motion's
  // SSR'd opacity:0 inline style on the hydrated DOM (React skips the stale
  // attribute), blanking content for prefers-reduced-motion users.
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      transition={reduced ? { duration: 0 } : { duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Use-case page hero: centered kicker → staged headline → lede → pill
 * CTAs on the page's own gradient scene. Exactly one per page (the h1).
 */
export function UseCaseHero({
  kicker,
  headline,
  lede,
  scene,
  primaryLabel = "Start creating",
  primaryHref = "/sign-up",
  secondaryLabel = "See pricing",
  secondaryHref = "/pricing",
  placeholderLabel,
  placeholderTone = "slate",
}: {
  kicker: string;
  /** Headline lines; each renders as its own TextReveal span. */
  headline: string[];
  lede: string;
  scene: SceneName;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  /** When set, renders a tagged image placeholder near the top of the hero. */
  placeholderLabel?: string;
  placeholderTone?: PlaceholderTone;
}) {
  return (
    <section aria-label="Introduction" className="px-4 pt-24 md:px-6 md:pt-28">
      <UseCaseScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        name={scene}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/40 to-transparent"
        />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
          <FadeUp delay={0.1}>
            <Kicker>{kicker}</Kicker>
          </FadeUp>
          <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.02] tracking-tight text-balance text-zinc-900 md:text-6xl lg:text-7xl">
            {headline.map((line, i) => (
              <TextReveal
                as="span"
                className="block"
                delay={0.05 + i * 0.12}
                key={line}
              >
                {line}
              </TextReveal>
            ))}
          </h1>
          <FadeUp delay={0.55}>
            <Lede className="mx-auto mt-6">{lede}</Lede>
          </FadeUp>
          <FadeUp
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
            delay={0.7}
          >
            <Magnetic>
              <CtaPill href={primaryHref} size="lg">
                {primaryLabel}
              </CtaPill>
            </Magnetic>
            <CtaPill href={secondaryHref} size="lg" variant="secondary">
              {secondaryLabel}
            </CtaPill>
          </FadeUp>
          {placeholderLabel ? (
            <FadeUp className="mt-14" delay={0.85}>
              <div className="mx-auto aspect-[16/8] w-full overflow-hidden rounded-[2rem] border border-zinc-900/[0.06] shadow-[0_16px_60px_rgba(15,23,42,0.08)]">
                <TaggedPlaceholder
                  className="h-full w-full"
                  kind="image"
                  label={placeholderLabel}
                  tone={placeholderTone}
                />
              </div>
            </FadeUp>
          ) : null}
        </div>
      </UseCaseScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* "The grind today" — short pain framing                              */
/* ------------------------------------------------------------------ */

export function PainBand({
  heading,
  lede,
  pains,
}: {
  heading: string;
  lede?: string;
  pains: Array<{ title: string; copy: string }>;
}) {
  return (
    <section
      aria-label="The grind today"
      className="mx-auto max-w-6xl px-6 py-24 md:py-32"
    >
      <Reveal className="max-w-2xl">
        <Kicker>The grind today</Kicker>
        <DisplayHeading className="mt-4">{heading}</DisplayHeading>
        {lede ? <Lede className="mt-5">{lede}</Lede> : null}
      </Reveal>
      <Stagger
        className="mt-12 grid gap-4 md:grid-cols-3"
        gap={0.06}
        itemClassName="h-full"
      >
        {pains.map((p) => (
          <div
            className="h-full rounded-2xl border border-zinc-900/[0.06] bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.04)]"
            key={p.title}
          >
            <span aria-hidden className="block size-2 rounded-full bg-zinc-300" />
            <h3 className="mt-4 font-display text-lg font-semibold tracking-tight text-zinc-900">
              {p.title}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
              {p.copy}
            </p>
          </div>
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* "With marketer.sh" — the 3-step band                                */
/* ------------------------------------------------------------------ */

export function StepsBand({
  heading,
  lede,
  steps,
}: {
  heading: string;
  lede?: string;
  steps: Array<{ title: string; copy: string }>;
}) {
  return (
    <section aria-label="With marketer.sh" className="px-4 py-6 md:px-6">
      <div className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.06] bg-white shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <Reveal className="max-w-2xl">
            <Kicker>With marketer.sh</Kicker>
            <DisplayHeading className="mt-4">{heading}</DisplayHeading>
            {lede ? <Lede className="mt-5">{lede}</Lede> : null}
          </Reveal>
          <Stagger className="mt-14 grid gap-10 md:grid-cols-3" gap={0.1}>
            {steps.map((s, i) => (
              <div key={s.title}>
                <p className="font-mono text-xs font-medium tabular-nums text-zinc-400">
                  0{i + 1}
                </p>
                <div
                  aria-hidden
                  className="mt-3 h-px w-10 bg-zinc-900/10"
                />
                <h3 className="mt-4 font-display text-xl font-semibold tracking-tight text-zinc-900">
                  {s.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-zinc-600">
                  {s.copy}
                </p>
              </div>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Product-moment band — copy beside a floating glass mock             */
/* ------------------------------------------------------------------ */

export function MockBand({
  kicker,
  heading,
  lede,
  bullets,
  scene,
  children,
  flip = false,
}: {
  kicker: string;
  heading: string;
  lede: string;
  bullets?: string[];
  scene: SceneName;
  /** The hand-built glass product-moment mock. */
  children: React.ReactNode;
  /** Put the mock on the left on desktop. */
  flip?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <section aria-label="Product moment" className="px-4 py-6 md:px-6">
      <UseCaseScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        name={scene}
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal className={cn(flip && "lg:order-2")}>
            <Kicker>{kicker}</Kicker>
            <DisplayHeading className="mt-4">{heading}</DisplayHeading>
            <Lede className="mt-5">{lede}</Lede>
            {bullets && bullets.length > 0 ? (
              <ul className="mt-8 space-y-3">
                {bullets.map((b) => (
                  <li
                    className="flex items-start gap-3 text-[15px] leading-relaxed text-zinc-600"
                    key={b}
                  >
                    <span
                      aria-hidden
                      className="mt-2.5 block size-1.5 shrink-0 rounded-full bg-zinc-300"
                    />
                    {b}
                  </li>
                ))}
              </ul>
            ) : null}
          </Reveal>
          <Reveal
            className={cn("flex justify-center", flip && "lg:order-1")}
            delay={0.1}
          >
            <motion.div
              animate={reduced ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
            >
              {children}
            </motion.div>
          </Reveal>
        </div>
      </UseCaseScene>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Outcomes — StatStrip with a quiet intro                             */
/* ------------------------------------------------------------------ */

export function OutcomesBand({
  heading = "What changes",
  stats,
}: {
  heading?: string;
  stats: Stat[];
}) {
  return (
    <section
      aria-label="Outcomes"
      className="mx-auto max-w-6xl px-6 py-24 md:py-28"
    >
      <Reveal className="mx-auto max-w-2xl text-center">
        <Kicker>Outcomes</Kicker>
        <DisplayHeading className="mt-4" size="md">
          {heading}
        </DisplayHeading>
      </Reveal>
      <StatStrip className="mt-12" stats={stats} />
    </section>
  );
}
