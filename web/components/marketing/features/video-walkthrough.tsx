"use client";

import * as React from "react";

import {
  Kicker,
  Lede,
  PinScene,
  Reveal,
  Stagger,
  TaggedPlaceholder,
  TextReveal,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/**
 * The real production line, stage by stage. `macro` maps each stage to the
 * pipeline illustration's coarse phases (0 Ideate · 1 Script · 2 Render ·
 * 3 Publish) so the drawing lights up as the rail advances.
 */
const STAGES: Array<{
  label: string;
  copy: string;
  tag?: string;
  macro: number;
}> = [
  {
    label: "Ideation",
    copy: "Angles picked for your niche, steered by what the last round earned.",
    tag: "metrics-fed",
    macro: 0,
  },
  {
    label: "Script",
    copy: "Written scene by scene: hook, shots, lines, and timing.",
    macro: 1,
  },
  {
    label: "Keyframes",
    copy: "gpt-image-1 frames, kept on-model by the niche's character sheet.",
    tag: "gpt-image-1",
    macro: 2,
  },
  {
    label: "Animation",
    copy: "Keyframes become motion, one scene at a time.",
    macro: 2,
  },
  {
    label: "Voiceover",
    copy: "TTS with steerable delivery. Pace, tone, and emphasis to order.",
    macro: 2,
  },
  {
    label: "Music",
    copy: "A bed ducked under the voice. Never over it.",
    macro: 2,
  },
  {
    label: "Edit",
    copy: "ffmpeg assembles scenes, voice, and music into the cut.",
    tag: "ffmpeg",
    macro: 2,
  },
  {
    label: "Captions",
    copy: "Word-level karaoke captions, timed to the voice.",
    macro: 2,
  },
  {
    label: "QA",
    copy: "Every cut is checked before it can publish.",
    macro: 3,
  },
  {
    label: "Publish",
    copy: "Scheduled to TikTok, Reels, and Shorts in your niche's windows.",
    macro: 3,
  },
];

function Header() {
  return (
    <div className="max-w-2xl">
      <Kicker>The production line</Kicker>
      <TextReveal
        as="h2"
        className="mt-4 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-900 md:text-5xl"
      >
        Ten stages. Zero hand-offs.
      </TextReveal>
      <Lede className="mt-4">
        What an editor, a voice actor, and a social manager would do in a
        week, run as one pipeline.
      </Lede>
    </div>
  );
}

function StageNumber({ index, on }: { index: number; on?: boolean }) {
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums transition-colors duration-500",
        on === undefined ? "text-zinc-400" : on ? "text-zinc-900" : "text-zinc-300",
      )}
    >
      {String(index + 1).padStart(2, "0")}
    </span>
  );
}

function StageTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-zinc-900/[0.05] px-2 py-0.5 font-mono text-[10px] text-zinc-500">
      {children}
    </span>
  );
}

function Rail({ active }: { active: number }) {
  return (
    <ol className="space-y-0.5">
      {STAGES.map((s, i) => {
        const on = i === active;
        return (
          <li
            className={cn(
              "rounded-xl border px-4 py-2 transition-all duration-500",
              on
                ? "border-zinc-900/[0.08] bg-white shadow-[0_8px_30px_rgba(15,23,42,0.07)]"
                : "border-transparent",
            )}
            key={s.label}
          >
            <div className="flex items-baseline gap-3">
              <StageNumber index={i} on={on} />
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-display text-[15px] font-semibold tracking-tight transition-colors duration-500",
                    on ? "text-zinc-900" : "text-zinc-400",
                  )}
                >
                  {s.label}
                </p>
                <p
                  className={cn(
                    "text-[13px] leading-snug transition-all duration-500",
                    on
                      ? "mt-0.5 max-h-12 text-zinc-500 opacity-100"
                      : "max-h-0 overflow-hidden opacity-0",
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

function Scene({ stage }: { stage: number }) {
  return (
    <div className="mx-auto max-w-6xl px-6">
      <Header />
      <div className="mt-8 grid items-center gap-10 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Rail active={stage} />
        <div className="aspect-[4/3] overflow-hidden rounded-[2rem] border border-zinc-900/[0.05] shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
          <TaggedPlaceholder
            kind="illustration"
            label="Scene-by-scene pipeline"
            tone="violet"
          />
        </div>
      </div>
    </div>
  );
}

/** Static fallback: the numbered rail as a staggered two-column grid. */
function StaticWalkthrough() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <Reveal>
        <Header />
      </Reveal>
      <Stagger className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2" gap={0.06}>
        {STAGES.map((s, i) => (
          <div className="flex items-baseline gap-3" key={s.label}>
            <StageNumber index={i} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-lg font-semibold tracking-tight text-zinc-900">
                  {s.label}
                </p>
                {s.tag ? <StageTag>{s.tag}</StageTag> : null}
              </div>
              <p className="mt-1 text-sm leading-snug text-zinc-500">{s.copy}</p>
            </div>
          </div>
        ))}
      </Stagger>
    </div>
  );
}

/**
 * Pins the walkthrough and drives the stage rail from the scrub position.
 * The pin/scrub is GSAP-owned (the only PinScene on the features pages);
 * the active stage lives in React state so `Rail`/`Scene` keep their plain
 * prop-driven rendering.
 */
function PinnedWalkthrough() {
  const [stage, setStage] = React.useState(0);
  const stageRef = React.useRef(0);

  return (
    <PinScene
      build={(_el, tl) => {
        const proxy = { value: 0 };
        tl.to(proxy, {
          value: STAGES.length - 1,
          ease: "none",
          onUpdate: () => {
            const next = Math.round(proxy.value);
            if (next !== stageRef.current) {
              stageRef.current = next;
              setStage(next);
            }
          },
        });
      }}
      lengthVh={150}
    >
      <Scene stage={stage} />
    </PinScene>
  );
}

/**
 * The stage walkthrough. On large screens it pins and scroll advances the
 * ten-stage rail while the pipeline diagram tracks along. Small screens and
 * reduced motion get the static numbered rail with a Reveal stagger.
 */
export function VideoWalkthrough() {
  return (
    <section aria-label="The ten video stages">
      <div className="hidden lg:block">
        <PinnedWalkthrough />
      </div>
      <div className="lg:hidden">
        <StaticWalkthrough />
      </div>
    </section>
  );
}
