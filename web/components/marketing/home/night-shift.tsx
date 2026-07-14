"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import {
  DisplayHeading,
  EASE,
  GlassPanel,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  Stagger,
} from "@/components/marketing/system";

const MOMENTS: Array<{ time: string; copy: string; live?: boolean }> = [
  { time: "11:40 PM", copy: "You set the cap to $10 and go to bed." },
  { time: "2:00 AM", copy: "Topic picked. Script written." },
  { time: "2:14 AM", copy: "Frames rendered. Voice recorded." },
  { time: "2:19 AM", copy: "Captions burned. QA passed." },
  {
    time: "7:00 AM",
    copy: "Two shorts and an article waiting for approval. $1.86 spent.",
  },
  {
    time: "9:00 AM",
    copy: "Approved from your phone. Posted on schedule.",
    live: true,
  },
];

/** The recording light: small pulsing brand-orange dot on the final chip. */
function LiveDot() {
  const reduced = useReducedMotion();
  return (
    <span className="relative flex size-2">
      {!reduced && (
        <motion.span
          animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
          className="absolute inline-flex h-full w-full rounded-full bg-brand"
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className="relative inline-flex size-2 rounded-full bg-brand" />
    </span>
  );
}

/**
 * "While you slept." One night's story as a timeline of glass time-chips:
 * horizontal on desktop, vertical on mobile. Chips reveal in sequence, a
 * thin progress line draws between them, and the final chip carries the
 * brand-orange live dot.
 */
export function NightShift() {
  const reduced = useReducedMotion();

  return (
    <section aria-label="While you slept" className="px-4 pt-4 md:px-6 md:pt-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <Reveal className="max-w-2xl">
            <Kicker>The night shift</Kicker>
            <DisplayHeading className="mt-4">While you slept.</DisplayHeading>
            <Lede className="mt-5">
              Set a cap, close the laptop. This is what the pipeline does with
              six quiet hours.
            </Lede>
          </Reveal>

          <div className="relative mt-14">
            {/* Timeline rails: vertical on mobile, horizontal on desktop */}
            <div
              aria-hidden
              className="absolute bottom-16 left-[5px] top-1.5 w-px bg-zinc-900/[0.08] lg:bottom-auto lg:left-2 lg:right-2 lg:top-[5px] lg:h-px lg:w-auto"
            />
            {!reduced && (
              <>
                <motion.div
                  aria-hidden
                  className="absolute bottom-16 left-[5px] top-1.5 w-px origin-top bg-zinc-900/25 lg:hidden"
                  initial={{ scaleY: 0 }}
                  transition={{ duration: 1.8, ease: EASE, delay: 0.2 }}
                  viewport={{ once: true, margin: "-80px" }}
                  whileInView={{ scaleY: 1 }}
                />
                <motion.div
                  aria-hidden
                  className="absolute left-2 right-2 top-[5px] hidden h-px origin-left bg-zinc-900/25 lg:block"
                  initial={{ scaleX: 0 }}
                  transition={{ duration: 1.8, ease: EASE, delay: 0.2 }}
                  viewport={{ once: true, margin: "-80px" }}
                  whileInView={{ scaleX: 1 }}
                />
              </>
            )}

            <Stagger
              className="grid gap-5 lg:grid-cols-6 lg:gap-4"
              gap={0.12}
              itemClassName="relative pl-8 lg:pl-0 lg:pt-8"
            >
              {MOMENTS.map((m) => (
                <React.Fragment key={m.time}>
                  {/* Node on the timeline */}
                  <span
                    aria-hidden
                    className="absolute left-0 top-1 size-[11px] rounded-full border border-zinc-900/15 bg-white shadow-sm lg:left-2 lg:top-0"
                  />
                  <GlassPanel className="rounded-2xl p-4 lg:min-h-[8.5rem]">
                    <p className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-zinc-400">
                      {m.time}
                      {m.live ? <LiveDot /> : null}
                    </p>
                    <p className="mt-2 text-[13px] leading-snug text-zinc-700">
                      {m.copy}
                    </p>
                  </GlassPanel>
                </React.Fragment>
              ))}
            </Stagger>
          </div>

          <Reveal
            className="mt-12 flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between"
            delay={0.2}
          >
            <p className="max-w-lg font-display text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
              That was the machine&apos;s night shift. Yours cost nothing.
            </p>
            <Link
              className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900 transition-colors hover:text-zinc-600"
              href="/sign-up"
            >
              Set your cap tonight
              <svg
                aria-hidden
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            </Link>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}
