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
  kicker: _kicker,
  headline,
  lede,
  scene: _scene,
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
    <section
      aria-label="Introduction"
      className="mx-auto max-w-[1440px] px-5 pt-28 sm:px-8 sm:pt-32 lg:px-10"
    >
      <div className="mx-auto max-w-3xl py-16 text-center md:py-24">
        <FadeUp delay={0.1}>
          <DisplayHeading className="mx-auto" level={1} size="xl">
            {headline.join(" ")}
          </DisplayHeading>
        </FadeUp>
        <FadeUp delay={0.28}>
          <Lede className="mx-auto mt-6">{lede}</Lede>
        </FadeUp>
        <FadeUp
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
          delay={0.42}
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
          <FadeUp className="mt-14" delay={0.55}>
            <div className="mx-auto aspect-[16/8] w-full overflow-hidden rounded-3xl border border-border">
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
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* "The grind today" - short pain framing                              */
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
            className="border-border bg-background h-full rounded-2xl border p-6"
            key={p.title}
          >
            <span aria-hidden className="block size-2 rounded-full bg-muted-foreground/40" />
            <h3 className="mt-4 font-display text-lg font-medium tracking-tight text-foreground">
              {p.title}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
              {p.copy}
            </p>
          </div>
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* "With marketer.sh" - the 3-step band                                */
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
      <div className="border-border bg-muted mx-auto max-w-[88rem] rounded-[2.5rem] border">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <Reveal className="max-w-2xl">
            <Kicker>With marketer.sh</Kicker>
            <DisplayHeading className="mt-4">{heading}</DisplayHeading>
            {lede ? <Lede className="mt-5">{lede}</Lede> : null}
          </Reveal>
          <Stagger className="mt-14 grid gap-10 md:grid-cols-3" gap={0.1}>
            {steps.map((s, i) => (
              <div key={s.title}>
                <p className="font-mono text-xs font-medium tabular-nums text-muted-foreground">
                  0{i + 1}
                </p>
                <div
                  aria-hidden
                  className="mt-3 h-px w-10 bg-muted"
                />
                <h3 className="mt-4 font-display text-xl font-medium tracking-tight text-foreground">
                  {s.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
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
/* Product-moment band - copy beside a floating glass mock             */
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
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-border"
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
                    className="flex items-start gap-3 text-[15px] leading-relaxed text-muted-foreground"
                    key={b}
                  >
                    <span
                      aria-hidden
                      className="bg-foreground mt-2.5 block size-1.5 shrink-0 rounded-full"
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
/* Outcomes - StatStrip with a quiet intro                             */
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
