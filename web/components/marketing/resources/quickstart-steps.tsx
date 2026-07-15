"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  GlassPanel,
  Reveal,
  VIGNETTE_SCENES,
  type VignetteScene,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Small glass mocks, one per step                                     */
/* ------------------------------------------------------------------ */

function RecordingDot({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <span className={cn("relative flex size-2", className)}>
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

function MockRow({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border border-zinc-900/[0.06] bg-white/80 px-3.5 py-2.5",
        className,
      )}
    >
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-xs font-medium text-zinc-800">{value}</span>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("size-3.5", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function SignUpMock() {
  return (
    <GlassPanel className="p-5">
      <p className="text-xs font-medium text-zinc-500">Create your account</p>
      <div className="mt-3 rounded-xl border border-zinc-900/[0.08] bg-white px-3.5 py-2.5 text-xs text-zinc-400">
        you@studio.com
      </div>
      <div className="mt-2 flex items-center justify-between rounded-xl bg-zinc-900 px-3.5 py-2.5 text-xs font-medium text-white">
        Continue
        <span aria-hidden>→</span>
      </div>
      <p className="mt-3 text-[11px] text-zinc-400">
        No card required. Credit is prepaid, later, when you are ready.
      </p>
    </GlassPanel>
  );
}

function BriefMock() {
  return (
    <GlassPanel className="p-5">
      <p className="text-xs font-medium text-zinc-500">Your one sentence</p>
      <p className="mt-3 rounded-xl border border-zinc-900/[0.08] bg-white px-3.5 py-3 text-[13px] leading-relaxed text-zinc-800">
        &ldquo;Honest gear reviews for home espresso people who don&apos;t want
        to spend $2,000.&rdquo;
      </p>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
        <RecordingDot />
        Drafting niche: audience, tone, topics, posting plan…
      </div>
    </GlassPanel>
  );
}

function ReviewMock() {
  return (
    <GlassPanel className="space-y-2 p-5">
      <MockRow label="Voice" value="Warm host, mid pace" />
      <MockRow label="Visual style" value="Kinetic captions" />
      <MockRow
        label="Daily cap"
        value={<span className="font-mono tabular-nums">$10.00</span>}
      />
      <MockRow
        label="Approval"
        value={
          <span className="inline-flex items-center gap-1.5 text-zinc-800">
            <CheckIcon className="size-3 text-zinc-900" />
            Review before post
          </span>
        }
      />
    </GlassPanel>
  );
}

function FirstVideoMock() {
  return (
    <GlassPanel className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500">
          The $200 grinder that beats the hype
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/[0.07] px-2.5 py-1 text-[11px] font-medium text-zinc-700">
          <RecordingDot />
          Rendering
        </span>
      </div>
      <div className="mt-3 flex h-20 items-end gap-1 rounded-xl border border-zinc-900/[0.06] bg-gradient-to-b from-sky-50 to-indigo-50 p-3">
        {[38, 62, 45, 78, 52, 66, 40, 72, 58, 30].map((h, i) => (
          <span
            className="w-full rounded-full bg-zinc-900/15"
            key={i}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
        <span className="font-mono tabular-nums">script → keyframes → animate → voice</span>
        <span className="rounded-full bg-zinc-900 px-2.5 py-1 font-medium text-white">
          Approve
        </span>
      </div>
    </GlassPanel>
  );
}

function ArticlesMock() {
  return (
    <GlassPanel className="p-5">
      <p className="text-xs font-medium text-zinc-500">Article pipeline</p>
      <div className="mt-3 space-y-1.5 font-mono text-[11px] leading-relaxed text-zinc-600">
        <p>
          <CheckIcon className="mr-1.5 inline size-3 text-amber-600" />
          SERP research · 9 competitors read
        </p>
        <p>
          <CheckIcon className="mr-1.5 inline size-3 text-amber-600" />
          Outline · 7 sections, 3 FAQs
        </p>
        <p className="flex items-center gap-1.5 text-zinc-800">
          <RecordingDot />
          Writing sections in parallel…
        </p>
        <p className="text-zinc-400">· QA, metadata, JSON-LD, hero image</p>
      </div>
    </GlassPanel>
  );
}

function WindowsMock() {
  return (
    <GlassPanel className="p-5">
      <p className="text-xs font-medium text-zinc-500">Posting windows</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          ["TikTok", "9:00"],
          ["Reels", "12:30"],
          ["Shorts", "18:00"],
        ].map(([p, t]) => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-900/10 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-zinc-700"
            key={p}
          >
            {p}
            <span className="font-mono tabular-nums text-zinc-400">{t}</span>
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-900/[0.06] bg-white/80 px-3.5 py-2.5">
        <span className="text-xs text-zinc-500">Autopilot</span>
        <span className="inline-flex items-center gap-2 text-xs font-medium text-zinc-800">
          <span className="flex h-4 w-7 items-center rounded-full bg-zinc-900 px-0.5">
            <span className="ml-auto size-3 rounded-full bg-white" />
          </span>
          On
        </span>
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/* The rail                                                            */
/* ------------------------------------------------------------------ */

const STEPS: Array<{
  title: string;
  copy: string;
  mock: React.ReactNode;
  scene: VignetteScene;
}> = [
  {
    title: "Sign up",
    copy: "Create an account with your email. There is nothing to install and no card required, your workspace is live in under a minute.",
    mock: <SignUpMock />,
    scene: "pearl",
  },
  {
    title: "Describe your channel in one sentence",
    copy: "Write one honest sentence about who you talk to and what you make. The AI drafts the full niche from it: audience, tone, topic pillars, and a starting posting plan.",
    mock: <BriefMock />,
    scene: "sky",
  },
  {
    title: "Review voice, style, and caps",
    copy: "Everything the draft chose is editable. Pick the narration voice, set the visual style, and put a hard daily cap on spend before anything renders.",
    mock: <ReviewMock />,
    scene: "mist",
  },
  {
    title: "Your first video renders. Approve it",
    copy: "The pipeline runs end to end: script, on-model keyframes, animation, voiceover, captions, QA. You watch the result and approve or reject with one click.",
    mock: <FirstVideoMock />,
    scene: "dawn",
  },
  {
    title: "Add articles",
    copy: "Turn on the SEO pipeline for the same niche. It researches the SERP, outlines, writes sections in parallel, then ships metadata, JSON-LD, and a hero image with every draft.",
    mock: <ArticlesMock />,
    scene: "dusk",
  },
  {
    title: "Set posting windows and let it run",
    copy: "Choose when each platform posts and how many per day. From here the system ideates, produces, publishes, and learns from performance, inside the caps you set.",
    mock: <WindowsMock />,
    scene: "warm",
  },
];

/**
 * The quickstart's numbered rail: a vertical hairline with numbered nodes,
 * step copy on the left and a small glass product mock on the right.
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
                {/* vignette frame: mock staged on a scene wash (Amendment 2) */}
                <div
                  className={cn(
                    "rounded-2xl p-3 ring-1 ring-inset ring-zinc-900/[0.05] sm:p-4",
                    VIGNETTE_SCENES[step.scene],
                  )}
                >
                  {step.mock}
                </div>
              </div>
            </div>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
