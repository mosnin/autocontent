"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { MediaSlot } from "@/components/media-slot";
import { EASE } from "@/components/marketing/system/motion";
import { Magnetic, Parallax } from "@/components/marketing/system";
import RotatingText from "@/components/reactbits/RotatingText";

/** Feature chip rows under the hero copy, like the reference's capability
 *  pills. First chip is highlighted; every chip links somewhere real. */
const CHIP_ROWS: Array<Array<{ label: string; href: string; hot?: boolean }>> = [
  [
    { label: "Studio", href: "/features/video", hot: true },
    { label: "Press", href: "/features/articles" },
    { label: "Ads", href: "/features" },
    { label: "AI Agents", href: "/features/automation" },
    { label: "Autopilot", href: "/resources/guides/agent-driven-marketing" },
  ],
  [
    { label: "Scheduling", href: "/features/video" },
    { label: "Analytics", href: "/features/analytics" },
    { label: "Spend caps", href: "/features/analytics" },
    { label: "Brand kit", href: "/features" },
    { label: "Approvals", href: "/features/analytics" },
  ],
  [
    { label: "API", href: "/resources/api" },
    { label: "SDK", href: "/resources/api" },
    { label: "CLI", href: "/resources/api" },
    { label: "MCP server", href: "/resources/api" },
    { label: "Audit trail", href: "/features/analytics" },
  ],
];

export function Hero() {
  const reduced = useReducedMotion();

  const enter = (delay: number) =>
    reduced
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.2 },
        }
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, ease: EASE, delay },
        };

  return (
    <section aria-label="Hero" className="overflow-hidden bg-white">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-16 pt-14 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-8">
        {/* Copy */}
        <div>
          <motion.h1
            {...enter(0)}
            className="font-display text-5xl font-semibold leading-[1.04] tracking-tight text-zinc-950 md:text-6xl"
          >
            Maximize your
            <br />
            <span className="flex flex-wrap items-center gap-x-3">
              <RotatingText
                auto={!reduced}
                mainClassName="inline-flex overflow-hidden rounded-2xl bg-zinc-900 px-3 py-1 text-white md:px-4"
                rotationInterval={2600}
                splitLevelClassName="overflow-hidden pb-1"
                staggerDuration={0.02}
                staggerFrom="last"
                texts={["marketing", "video", "article", "ad"]}
                transition={{ type: "spring", damping: 30, stiffness: 400 }}
              />
              output.
            </span>
          </motion.h1>

          <motion.p
            {...enter(0.08)}
            className="mt-6 max-w-[42ch] text-lg leading-relaxed text-zinc-600"
          >
            Replace the whole content stack. Every video, article, and agent
            in one place, with hard caps on every dollar spent.
          </motion.p>

          <motion.div
            {...enter(0.16)}
            className="mt-8 flex flex-wrap items-center gap-4"
          >
            <Magnetic>
              <Link
                className="inline-flex min-h-12 items-center rounded-xl bg-zinc-900 px-7 text-[15px] font-semibold text-white shadow-[0_2px_12px_rgba(15,23,42,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
                href="/sign-up"
              >
                Get started. It&apos;s $5.
              </Link>
            </Magnetic>
            <p className="text-sm leading-snug text-zinc-500">
              Prepaid credits from $5.
              <br />
              No subscription. No autopay.
            </p>
          </motion.div>

          <motion.p
            {...enter(0.24)}
            className="mt-12 font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-zinc-500"
          >
            Ship every format &bull; Customize your pipeline
          </motion.p>

          <motion.div {...enter(0.3)} className="mt-4 space-y-2.5">
            {CHIP_ROWS.map((row, i) => (
              <div className="flex flex-wrap gap-2.5" key={i}>
                {row.map((chip) => (
                  <Link
                    className={
                      chip.hot
                        ? "inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-[linear-gradient(135deg,rgba(245,158,11,0.10),rgba(244,63,94,0.08))] px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:border-amber-500/70"
                        : "inline-flex items-center rounded-full border border-zinc-900/10 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-900/30 hover:text-zinc-950"
                    }
                    href={chip.href}
                    key={chip.label}
                  >
                    {chip.hot ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-[linear-gradient(135deg,#f59e0b,#f43f5e)]"
                      />
                    ) : null}
                    {chip.label}
                  </Link>
                ))}
              </div>
            ))}
          </motion.div>
        </div>

        {/* Product shot: bleeds off the right edge like the reference. */}
        <motion.div {...enter(0.18)} className="relative lg:-mr-24 xl:-mr-32">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-8 rounded-[3rem] bg-[radial-gradient(80%_80%_at_30%_20%,rgba(245,158,11,0.08),rgba(244,63,94,0.05)_50%,transparent_80%)]"
          />
          <div className="group relative aspect-[13/10] overflow-hidden rounded-2xl shadow-[0_24px_80px_rgba(15,23,42,0.14)] lg:rounded-r-none">
            <Parallax className="h-full w-full" speed={-0.1}>
              <MediaSlot id="mk-hero" />
            </Parallax>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
