import * as React from "react";

import { Reveal, TaggedPlaceholder } from "@/components/marketing/system";

const STEPS: Array<{
  title: string;
  copy: string;
  shot: string;
}> = [
  {
    title: "Sign up",
    copy: "Create an account with your email. There is nothing to install and no card required, your workspace is live in under a minute.",
    shot: "Sign-up screen",
  },
  {
    title: "Describe your channel in one sentence",
    copy: "Write one honest sentence about who you talk to and what you make. The AI drafts the full niche from it: audience, tone, topic pillars, and a starting posting plan.",
    shot: "Niche brief form",
  },
  {
    title: "Review voice, style, and caps",
    copy: "Everything the draft chose is editable. Pick the narration voice, set the visual style, and put a hard daily cap on spend before anything renders.",
    shot: "Voice, style, and cap review",
  },
  {
    title: "Your first video renders. Approve it",
    copy: "The pipeline runs end to end: script, on-model keyframes, animation, voiceover, captions, QA. You watch the result and approve or reject with one click.",
    shot: "First-video approval",
  },
  {
    title: "Add articles",
    copy: "Turn on the SEO pipeline for the same niche. It researches the SERP, outlines, writes sections in parallel, then ships metadata, JSON-LD, and a hero image with every draft.",
    shot: "Article pipeline toggle",
  },
  {
    title: "Set posting windows and let it run",
    copy: "Choose when each platform posts and how many per day. From here the system ideates, produces, publishes, and learns from performance, inside the caps you set.",
    shot: "Posting windows",
  },
];

/**
 * The quickstart's numbered rail: a vertical hairline with numbered nodes,
 * step copy on the left and a screenshot slot on the right.
 */
export function QuickstartSteps() {
  return (
    <ol className="relative space-y-16 md:space-y-20">
      {/* the rail */}
      <span
        aria-hidden
        className="absolute inset-y-4 left-[1.1875rem] w-px bg-zinc-900/[0.08]"
      />
      {STEPS.map((step, i) => (
        <li className="relative pl-16" key={step.title}>
          <span
            aria-hidden
            className="absolute left-0 top-0 flex size-10 items-center justify-center rounded-full border border-zinc-900/10 bg-white font-display text-sm font-semibold tabular-nums text-zinc-900 shadow-[0_2px_12px_rgba(15,23,42,0.08)]"
          >
            {i + 1}
          </span>
          <Reveal>
            <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-tight text-zinc-900 md:text-3xl">
                  {step.title}
                </h2>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-zinc-600 md:text-[17px]">
                  {step.copy}
                </p>
              </div>
              <div className="w-full max-w-sm lg:justify-self-end lg:pt-1">
                <div className="aspect-[4/3] overflow-hidden rounded-2xl ring-1 ring-inset ring-zinc-900/[0.05]">
                  <TaggedPlaceholder
                    kind="image"
                    label={`${step.shot} — screenshot`}
                  />
                </div>
              </div>
            </div>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
