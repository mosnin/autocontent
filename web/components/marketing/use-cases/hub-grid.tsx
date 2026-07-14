"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import {
  AnalyticsLoopIllustration,
  ArticleFlowIllustration,
  AutomationOrbitIllustration,
  SpendGuardIllustration,
  VideoPipelineIllustration,
} from "@/components/marketing/illustrations";
import { GlassPanel, Kicker, Stagger } from "@/components/marketing/system";
import { EASE } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Mini-visual for local business: a week strip lighting up             */
/* ------------------------------------------------------------------ */

const WEEK_DOTS = [false, true, false, true, false, true, false];

function WeekStripMotif({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className={cn("flex h-full w-full items-center justify-center gap-2", className)}
      initial={reduced ? false : "hidden"}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
      }}
      viewport={{ once: true, margin: "-40px" }}
      whileInView="show"
    >
      {WEEK_DOTS.map((posted, i) => (
        <motion.span
          className="flex h-16 w-9 flex-col items-center justify-end gap-1.5 rounded-xl border border-zinc-200 bg-white pb-2.5"
          key={i}
          variants={{
            hidden: { opacity: 0, y: 10 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.4, ease: EASE },
            },
          }}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              posted ? "bg-brand" : "bg-zinc-200",
            )}
          />
        </motion.span>
      ))}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* The six cards                                                       */
/* ------------------------------------------------------------------ */

const CASES: Array<{
  href: string;
  kicker: string;
  promise: string;
  visual: React.ReactNode;
}> = [
  {
    href: "/use-cases/creators",
    kicker: "Creators",
    promise: "Daily shorts without the editing days.",
    visual: <VideoPipelineIllustration className="h-full w-full" />,
  },
  {
    href: "/use-cases/ecommerce",
    kicker: "Ecommerce",
    promise: "Every product line becomes a content engine.",
    visual: <ArticleFlowIllustration className="h-full w-full" />,
  },
  {
    href: "/use-cases/saas",
    kicker: "SaaS",
    promise: "Shorts that teach, articles that convert.",
    visual: <AnalyticsLoopIllustration className="h-full w-full" />,
  },
  {
    href: "/use-cases/agencies",
    kicker: "Agencies",
    promise: "Every client on its own budget and gate.",
    visual: <SpendGuardIllustration className="h-full w-full" />,
  },
  {
    href: "/use-cases/local-business",
    kicker: "Local business",
    promise: "Show up every week without a marketing hire.",
    visual: <WeekStripMotif />,
  },
  {
    href: "/use-cases/ai-agents",
    kicker: "AI agents",
    promise: "Your agents are the marketing team.",
    visual: <AutomationOrbitIllustration className="h-full w-full" />,
  },
];

/** The hub's 6 glass cards, one per audience, each with a mini-visual. */
export function HubGrid() {
  return (
    <section
      aria-label="Use cases"
      className="mx-auto max-w-6xl px-6 py-16 md:py-24"
    >
      <Stagger
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        gap={0.08}
        itemClassName="h-full"
      >
        {CASES.map((c) => (
          <Link
            className="group block h-full rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
            href={c.href}
            key={c.href}
          >
            <GlassPanel className="flex h-full flex-col overflow-hidden transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_16px_50px_rgba(15,23,42,0.12)]">
              <div className="h-36 border-b border-zinc-900/[0.04] bg-[radial-gradient(110%_110%_at_50%_-10%,#f0f4ff_0%,#fafafa_70%)] p-4">
                {c.visual}
              </div>
              <div className="flex flex-1 flex-col p-6">
                <Kicker>{c.kicker}</Kicker>
                <h2 className="mt-2.5 font-display text-lg font-semibold leading-snug tracking-tight text-zinc-900">
                  {c.promise}
                </h2>
                <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-medium text-zinc-900">
                  See how
                  <svg
                    aria-hidden
                    className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
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
                </span>
              </div>
            </GlassPanel>
          </Link>
        ))}
      </Stagger>
    </section>
  );
}
