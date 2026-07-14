"use client";

import * as React from "react";
import { useMotionValueEvent, type MotionValue } from "motion/react";

import { VideoPipelineIllustration } from "@/components/marketing/illustrations";
import {
  DisplayHeading,
  Kicker,
  Lede,
  PinnedScene,
  Reveal,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    label: "Ideate",
    copy: "Trends, questions, and angles picked for your niche.",
  },
  { label: "Script", copy: "Hooks and beats written in your brand voice." },
  { label: "Render", copy: "Frames, motion, and voice mixed into a cut." },
  {
    label: "Publish",
    copy: "Posted on schedule to every connected channel.",
  },
  { label: "Learn", copy: "Retention and CTR feed the next brief." },
];

function Header() {
  return (
    <div className="max-w-2xl">
      <Kicker>The pipeline</Kicker>
      <DisplayHeading className="mt-4">
        Watch a post make itself.
      </DisplayHeading>
      <Lede className="mt-5">
        Here&apos;s the night shift, stage by stage.
      </Lede>
    </div>
  );
}

function CaptionRail({ active }: { active: number }) {
  return (
    <ol className="space-y-1">
      {STAGES.map((s, i) => {
        const on = i === active;
        return (
          <li
            className={cn(
              "rounded-2xl border px-5 py-4 transition-all duration-500",
              on
                ? "border-zinc-900/[0.08] bg-white shadow-[0_8px_30px_rgba(15,23,42,0.07)]"
                : "border-transparent",
            )}
            key={s.label}
          >
            <div className="flex items-baseline gap-3">
              <span
                className={cn(
                  "font-mono text-xs tabular-nums transition-colors duration-500",
                  on ? "text-zinc-900" : "text-zinc-300",
                )}
              >
                0{i + 1}
              </span>
              <div>
                <p
                  className={cn(
                    "font-display text-lg font-semibold tracking-tight transition-colors duration-500",
                    on ? "text-zinc-900" : "text-zinc-400",
                  )}
                >
                  {s.label}
                </p>
                <p
                  className={cn(
                    "text-sm leading-snug transition-all duration-500",
                    on ? "mt-1 max-h-12 text-zinc-500 opacity-100" : "max-h-0 overflow-hidden opacity-0",
                  )}
                >
                  {s.copy}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Scene({ progress }: { progress: MotionValue<number> }) {
  const [stage, setStage] = React.useState(0);
  useMotionValueEvent(progress, "change", (v) => {
    setStage(Math.max(0, Math.min(STAGES.length - 1, Math.floor(v * STAGES.length))));
  });

  return (
    <div className="mx-auto max-w-6xl px-6">
      <Header />
      <div className="mt-10 grid items-stretch gap-8 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="self-center">
          <CaptionRail active={stage} />
        </div>
        <div className="flex min-h-[24rem] items-center rounded-[2rem] border border-zinc-900/[0.05] bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.06)] md:p-8 xl:min-h-[27rem]">
          <VideoPipelineIllustration className="w-full" stage={stage} />
        </div>
      </div>
    </div>
  );
}

/** Reduced-motion / static fallback: header, illustration, caption row. */
function StaticStory() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <Reveal>
        <Header />
      </Reveal>
      <Reveal className="mt-12 rounded-[2rem] border border-zinc-900/[0.05] bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.06)] md:p-10" delay={0.1}>
        <VideoPipelineIllustration />
      </Reveal>
      <Reveal delay={0.15}>
        <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {STAGES.map((s, i) => (
            <li key={s.label}>
              <p className="font-mono text-xs text-zinc-400">0{i + 1}</p>
              <p className="mt-1 font-display text-lg font-semibold tracking-tight text-zinc-900">
                {s.label}
              </p>
              <p className="mt-1 text-sm leading-snug text-zinc-500">{s.copy}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </div>
  );
}

/**
 * The one pinned scene on the page: scrolling advances the pipeline stage
 * by stage while the caption rail follows along.
 */
export function PipelineStory() {
  return (
    <section aria-label="How the pipeline works">
      {/* The pinned scene only exists on large screens; small screens and
          reduced motion get the static story. */}
      <div className="hidden lg:block">
        <PinnedScene fallback={<StaticStory />} trackClassName="h-[300vh]">
          {(progress) => <Scene progress={progress} />}
        </PinnedScene>
      </div>
      <div className="lg:hidden">
        <StaticStory />
      </div>
    </section>
  );
}
