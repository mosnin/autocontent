"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { Reveal, Stagger } from "@/components/marketing/system";
import { EASE, VIEWPORT } from "@/components/marketing/system/motion";

const PAINS = [
  {
    title: "Tool switching",
    desc: "A video editor, a CMS, a scheduler, an ads console, a spreadsheet of budgets. Every handoff between them loses an hour and a little context.",
  },
  {
    title: "Budget blind spots",
    desc: "Generation and ad spend live in five dashboards, so nobody knows the real cost per post until the invoice lands. Overruns surface weeks late.",
  },
  {
    title: "Manual stitching",
    desc: "Someone still copies the script into the editor, the export into the scheduler, and the results into the report. That someone is your bottleneck.",
  },
];

/** Tangled scribble that resolves into a straight line — the reference's
 *  centerpiece graphic, drawn as an animated SVG path. */
function SprawlLine() {
  const reduced = useReducedMotion();
  return (
    <div aria-hidden className="relative mx-auto mt-14 max-w-4xl px-6">
      <svg
        className="w-full"
        fill="none"
        viewBox="0 0 800 160"
      >
        <motion.path
          d="M10 80 C 60 20, 90 150, 150 90 S 220 10, 260 90 S 320 160, 360 80 S 420 20, 470 80 C 510 128, 540 80, 590 80 L 740 80"
          initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
          stroke="url(#sprawl-grad)"
          strokeLinecap="round"
          strokeWidth="3"
          transition={{ duration: 1.8, ease: EASE }}
          viewport={VIEWPORT}
          whileInView={{ pathLength: 1 }}
        />
        <defs>
          <linearGradient id="sprawl-grad" x1="0" x2="800" y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#a1a1aa" />
            <stop offset="0.6" stopColor="#f59e0b" />
            <stop offset="1" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
        <motion.circle
          cx="740"
          cy="80"
          fill="#f43f5e"
          initial={reduced ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
          r="6"
          transition={{ delay: reduced ? 0 : 1.5, duration: 0.4, ease: EASE }}
          viewport={VIEWPORT}
          whileInView={{ scale: 1, opacity: 1 }}
        />
      </svg>
      <motion.span
        className="absolute right-0 top-1/2 hidden -translate-y-[150%] rounded-full border border-zinc-900/10 bg-white px-3 py-1 text-[12px] font-medium text-zinc-700 shadow-sm md:inline-block"
        initial={reduced ? { opacity: 1 } : { opacity: 0, y: 8 }}
        transition={{ delay: reduced ? 0 : 1.6, duration: 0.4, ease: EASE }}
        viewport={VIEWPORT}
        whileInView={{ opacity: 1, y: 0 }}
      >
        one pipeline
      </motion.span>
    </div>
  );
}

export function Sprawl() {
  return (
    <section aria-label="The problem" className="bg-white py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
            It&apos;s time to end tool sprawl.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-zinc-600">
            Most teams run marketing across six disconnected tools. The work
            isn&apos;t hard, the stitching is.
          </p>
        </Reveal>

        <SprawlLine />

        <Stagger className="mx-auto mt-16 grid max-w-5xl gap-10 md:grid-cols-3">
          {PAINS.map((p) => (
            <div className="text-center md:text-left" key={p.title}>
              <h3 className="text-lg font-semibold text-zinc-900">{p.title}</h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-600">
                {p.desc}
              </p>
            </div>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
