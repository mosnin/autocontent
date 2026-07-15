"use client";

import * as React from "react";
import Link from "next/link";

import { AnalyticsLoopIllustration } from "@/components/marketing/illustrations";
import {
  DisplayHeading,
  GradientScene,
  Kicker,
  Lede,
  Reveal,
  warmDot,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/** The performance loop: every post tunes the next brief. */
export function LearningLoop() {
  return (
    <section aria-label="The performance loop" className="px-4 py-6 md:px-6">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant="pearl"
      >
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 md:py-32 lg:grid-cols-2">
          <Reveal>
            <Kicker>Every post teaches the next one</Kicker>
            <DisplayHeading className="mt-4">
              It learns what works.
            </DisplayHeading>
            <Lede className="mt-5">
              Retention, click-through, and watch time flow back into ideation.
              Hooks that hold get more takes, topics that rank get siblings.
              Post 40 looks nothing like post 1, on purpose.
            </Lede>
            <ul className="mt-8 space-y-3">
              {[
                "Every post is scored against its niche baseline",
                "Winning hooks and formats are promoted automatically",
                "Underperformers are retired, not repeated",
              ].map((point) => (
                <li className="flex items-start gap-3 text-[15px] text-zinc-600" key={point}>
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[7px] size-1.5 shrink-0 rounded-full",
                      warmDot,
                    )}
                  />
                  {point}
                </li>
              ))}
            </ul>
            <Link
              className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-900 transition-colors hover:text-zinc-600"
              href="/features/analytics"
            >
              Explore analytics
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
          <Reveal delay={0.1}>
            <div className="rounded-[2rem] border border-white/60 bg-white/70 p-6 shadow-[0_8px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl md:p-8">
              <AnalyticsLoopIllustration />
            </div>
          </Reveal>
        </div>
      </GradientScene>
    </section>
  );
}
