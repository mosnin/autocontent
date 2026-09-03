"use client";

import { SectionHeading } from "@/components/marketing/section-heading";
import { CAMPAIGN_SRCS } from "@/lib/marketing/campaign-media";
import { useIsDesktop, useReducedMotion } from "@/lib/marketing/motion";
import { BadgeCheck, Sparkles, X } from "lucide-react";
import {
  cubicBezier,
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import Image from "next/image";
import { useRef, type ReactNode } from "react";

type Step = {
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    title: "Brief the niche",
    body: "One sentence is enough: who it is for, and what you sell. The agent fills in the rest.",
  },
  {
    title: "Produce the work",
    body: "Video and articles run in parallel from the same brief. Scripts, frames, voice, research, outline, write.",
  },
  {
    title: "Review before it ships",
    body: "Drafts wait behind an approval gate until you trust the output. Tighten or widen autonomy per niche, any time.",
  },
  {
    title: "Publish on schedule",
    body: "Approved work goes to TikTok, Reels, Shorts, and your site, on the schedule and budget you set.",
  },
];

const SCREEN_IMAGES = CAMPAIGN_SRCS;

const PROMPT =
  "35mm portrait at golden hour, wind in her hair, faint film grain";
const PROMPT_CHIPS = ["Portrait", "35mm", "Golden hour", "Grain"];

const STEP_COUNT = STEPS.length;
const SEGMENT = 1 / STEP_COUNT;
const FADE = 0.06;
const SHEET_EASE = cubicBezier(0.32, 0.72, 0, 1);

function presenceWindow(index: number): { input: number[]; output: number[] } {
  const enter = index * SEGMENT;
  const exit = (index + 1) * SEGMENT;
  if (index === 0) return { input: [exit - FADE, exit - 0.02], output: [1, 0] };
  if (index === STEP_COUNT - 1)
    return { input: [enter - 0.02, enter + FADE], output: [0, 1] };
  return {
    input: [enter - 0.02, enter + FADE, exit - FADE, exit - 0.02],
    output: [0, 1, 1, 0],
  };
}

function driftWindow(
  index: number,
  distance: number
): { input: number[]; output: number[] } {
  const enter = index * SEGMENT;
  const exit = (index + 1) * SEGMENT;
  if (index === 0) return { input: [0, exit], output: [0, -distance] };
  if (index === STEP_COUNT - 1)
    return { input: [enter - 0.02, 1], output: [distance, 0] };
  return { input: [enter - 0.02, exit], output: [distance, -distance] };
}

function ScreenChrome({ label }: { label: string }): ReactNode {
  return (
    <div className="flex items-center justify-between pt-11 pb-3">
      <span className="text-foreground text-[13px] font-medium tracking-tight">
        {label}
      </span>
      <span
        className="bg-foreground/10 size-6 rounded-full"
        aria-hidden="true"
      />
    </div>
  );
}

function DescribeScreen(): ReactNode {
  return (
    <div className="flex h-full flex-col px-4 pb-4">
      <ScreenChrome label="New shot" />
      <p className="text-foreground mt-3 text-xl font-medium tracking-tight">
        What do you see?
      </p>
      <div className="border-border bg-background mt-4 rounded-2xl border p-3.5">
        <p className="text-foreground text-[13px] leading-snug">
          {PROMPT}
          <span className="bg-foreground ml-0.5 inline-block h-3.5 w-px animate-pulse align-middle" />
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {PROMPT_CHIPS.map((chip) => (
          <span
            key={chip}
            className="border-border bg-background text-muted-foreground rounded-full border px-2.5 py-1 text-[10px] font-medium"
          >
            {chip}
          </span>
        ))}
      </div>
      <div className="flex-1" />
      <div className="bg-foreground text-background flex h-11 items-center justify-center gap-1.5 rounded-full text-xs font-medium">
        <Sparkles className="size-3.5" aria-hidden="true" />
        Generate
      </div>
    </div>
  );
}

function GenerateScreen(): ReactNode {
  return (
    <div className="flex h-full flex-col px-4 pb-4">
      <ScreenChrome label="Rendering" />
      <p className="text-muted-foreground text-[11px] font-medium">
        4 takes · about 12 seconds
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {SCREEN_IMAGES.slice(0, 3).map((src) => (
          <Image
            key={src}
            src={src}
            alt=""
            width={300}
            height={400}
            unoptimized
            className="aspect-[3/4] w-full rounded-xl object-cover"
          />
        ))}
        <div className="bg-foreground/10 aspect-[3/4] w-full animate-pulse rounded-xl" />
      </div>
      <div className="flex-1" />
      <div className="bg-foreground/10 h-1 overflow-hidden rounded-full">
        <div className="bg-foreground h-full w-3/4 rounded-full" />
      </div>
    </div>
  );
}

function ReviewScreen(): ReactNode {
  return (
    <div className="relative h-full">
      <Image
        src={SCREEN_IMAGES[3] ?? ""}
        alt=""
        width={600}
        height={1260}
        unoptimized
        className="absolute inset-0 h-full w-full object-cover"
      />
      <span className="bg-background text-foreground absolute top-11 left-4 rounded-full px-2.5 py-1 text-[10px] font-medium">
        Take 3 of 4
      </span>
      <div className="bg-background absolute inset-x-3 bottom-3 flex items-center gap-2.5 rounded-2xl p-3">
        <BadgeCheck
          className="text-foreground size-4 shrink-0"
          aria-hidden="true"
        />
        <div>
          <p className="text-foreground text-xs font-medium">Passed review</p>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            Sharp at 100% · No artifacts
          </p>
        </div>
      </div>
    </div>
  );
}

function LibraryScreen(): ReactNode {
  return (
    <div className="flex h-full flex-col px-3 pb-3">
      <div className="px-1">
        <ScreenChrome label="Camera roll" />
        <p className="text-muted-foreground text-[11px] font-medium">
          Saved at full resolution
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1">
        {SCREEN_IMAGES.map((src) => (
          <Image
            key={src}
            src={src}
            alt=""
            width={200}
            height={200}
            unoptimized
            className="aspect-square w-full rounded-md object-cover"
          />
        ))}
      </div>
    </div>
  );
}

const SCREENS: ReactNode[] = [
  <DescribeScreen key="describe" />,
  <GenerateScreen key="generate" />,
  <ReviewScreen key="review" />,
  <LibraryScreen key="library" />,
];

const ASIDES: ReactNode[] = [
  <>
    <div className="border-border bg-background rounded-2xl border p-4 shadow-sm">
      <p className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
        Direction
      </p>
      <p className="text-foreground mt-1.5 text-sm font-medium">
        ƒ/1.8 · 35mm · 3200K
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        wind in her hair, faint film grain
      </p>
    </div>
    <span className="border-border bg-background text-muted-foreground rounded-full border px-3.5 py-1.5 text-xs">
      Speaks photography
    </span>
  </>,
  <>
    <div className="border-border bg-background rounded-2xl border p-4 shadow-sm">
      <div className="flex items-center justify-between gap-8">
        <p className="text-foreground text-sm font-medium">Rendering takes</p>
        <p className="text-muted-foreground font-mono text-[10px] tabular-nums">
          11.8s
        </p>
      </div>
      <div className="mt-3 flex gap-1.5">
        <span className="bg-foreground h-1 w-9 rounded-full" />
        <span className="bg-foreground h-1 w-9 rounded-full" />
        <span className="bg-foreground h-1 w-9 rounded-full" />
        <span className="bg-border h-1 w-9 animate-pulse rounded-full" />
      </div>
    </div>
    <span className="border-border bg-background text-muted-foreground rounded-full border px-3.5 py-1.5 text-xs">
      Cloud render · 4K
    </span>
  </>,
  <>
    <div className="border-border bg-background flex items-start gap-2.5 rounded-2xl border p-4 shadow-sm">
      <BadgeCheck
        className="text-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <div>
        <p className="text-foreground text-sm font-medium">Passed review</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Sharp at 100% · no artifacts
        </p>
      </div>
    </div>
    <div className="border-border bg-background flex items-center gap-2 rounded-2xl border p-3 opacity-70 shadow-sm">
      <X
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden="true"
      />
      <p className="text-muted-foreground text-xs">2 takes rejected</p>
    </div>
  </>,
  <>
    <div className="border-border bg-background rounded-2xl border p-4 shadow-sm">
      <p className="text-foreground text-sm font-medium">
        Saved to camera roll
      </p>
      <p className="text-muted-foreground mt-1 text-xs">4096 × 5461 · 6.2 MB</p>
    </div>
    <span className="border-border bg-background text-muted-foreground rounded-full border px-3.5 py-1.5 text-xs">
      Synced to your library
    </span>
  </>,
];

function PhoneFrame({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="border-border bg-background w-[272px] rounded-[44px] border p-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.35)] sm:w-[300px] [@media(max-height:760px)]:w-[248px]">
      <div className="bg-muted relative aspect-[9/19] w-full overflow-hidden rounded-[36px]">
        {children}
        <div
          className="absolute top-2.5 left-1/2 h-[22px] w-[76px] -translate-x-1/2 rounded-full bg-black"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function ScreenLayer({
  progress,
  index,
  children,
}: {
  progress: MotionValue<number>;
  index: number;
  children: ReactNode;
}): ReactNode {
  const enter = index * SEGMENT;
  const cover = (index + 1) * SEGMENT;
  const isFirst = index === 0;
  const isLast = index === STEP_COUNT - 1;

  const y = useTransform(
    progress,
    isFirst ? [0, 1] : [enter - FADE, enter + FADE],
    isFirst ? ["0%", "0%"] : ["103%", "0%"],
    { ease: SHEET_EASE }
  );
  const scale = useTransform(
    progress,
    isLast ? [0, 1] : [cover - FADE, cover + FADE],
    isLast ? [1, 1] : [1, 0.93]
  );
  const dim = useTransform(
    progress,
    isLast ? [0, 1] : [cover - FADE, cover + FADE],
    isLast ? [0, 0] : [0, 0.42]
  );
  const radius = useTransform(
    progress,
    isFirst
      ? [cover - FADE, cover + FADE]
      : isLast
        ? [enter - FADE, enter + FADE]
        : [enter - FADE, enter + FADE, cover - FADE, cover + FADE],
    isFirst ? [0, 24] : isLast ? [32, 0] : [32, 0, 0, 24]
  );

  return (
    <motion.div
      style={{ y, scale, borderRadius: radius }}
      className="bg-muted absolute inset-0 overflow-hidden"
    >
      {children}
      <motion.div
        style={{ opacity: dim }}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-black"
      />
    </motion.div>
  );
}

function StepText({
  progress,
  index,
  step,
}: {
  progress: MotionValue<number>;
  index: number;
  step: Step;
}): ReactNode {
  const presence = presenceWindow(index);
  const drift = driftWindow(index, 36);
  const opacity = useTransform(progress, presence.input, presence.output);
  const y = useTransform(progress, drift.input, drift.output);

  return (
    <motion.div
      style={{ opacity, y }}
      className="absolute inset-0 flex flex-col justify-center"
    >
      <div className="flex items-center gap-4">
        <span className="text-foreground font-mono text-xs font-medium">
          0{index + 1}
        </span>
        <motion.span
          style={{ scaleX: opacity, originX: 0 }}
          className="bg-foreground block h-px w-12"
        />
      </div>
      <h3 className="text-foreground mt-5 text-3xl font-medium tracking-tight xl:text-4xl">
        {step.title}
      </h3>
      <p className="text-muted-foreground mt-4 max-w-sm text-base leading-relaxed">
        {step.body}
      </p>
    </motion.div>
  );
}

function StepAside({
  progress,
  index,
  children,
}: {
  progress: MotionValue<number>;
  index: number;
  children: ReactNode;
}): ReactNode {
  const presence = presenceWindow(index);
  const drift = driftWindow(index, 70);
  const opacity = useTransform(progress, presence.input, presence.output);
  const y = useTransform(progress, drift.input, drift.output);

  return (
    <motion.div
      style={{ opacity, y }}
      aria-hidden="true"
      className="absolute inset-0 flex flex-col items-start justify-center gap-4"
    >
      {children}
    </motion.div>
  );
}

function SegmentTick({
  progress,
  index,
}: {
  progress: MotionValue<number>;
  index: number;
}): ReactNode {
  const fill = useTransform(
    progress,
    [index * SEGMENT, (index + 1) * SEGMENT],
    [0, 1]
  );

  return (
    <span className="bg-border h-[3px] w-9 overflow-hidden rounded-full">
      <motion.span
        style={{ scaleX: fill, originX: 0 }}
        className="bg-foreground block h-full w-full"
      />
    </span>
  );
}

export function AppShowcase(): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: wrapperRef,
    offset: ["start start", "end end"],
  });

  const pinned = isDesktop && !prefersReducedMotion;

  return (
    <section id="how-it-works" className="scroll-mt-24 pb-24 sm:pb-32">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <SectionHeading
          title="From sentence to a running channel"
          description="The whole loop lives in one place. Brief, make, review, publish. Then do it again, inside the budget you set."
        />
      </div>

      {pinned ? (
        <div ref={wrapperRef} className="relative h-[420svh]">
          <div className="sticky top-0 flex h-svh items-center overflow-hidden">
            <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center gap-x-16 px-10">
              <div className="relative h-[340px]">
                {STEPS.map((step, i) => (
                  <StepText
                    key={step.title}
                    progress={scrollYProgress}
                    index={i}
                    step={step}
                  />
                ))}
              </div>

              <div className="relative">
                <div className="relative z-10 flex flex-col items-center gap-7">
                  <PhoneFrame>
                    <div className="absolute inset-0">
                      {SCREENS.map((screen, i) => (
                        <ScreenLayer
                          key={STEPS[i]?.title}
                          progress={scrollYProgress}
                          index={i}
                        >
                          {screen}
                        </ScreenLayer>
                      ))}
                    </div>
                  </PhoneFrame>
                  <div className="flex items-center gap-2" aria-hidden="true">
                    {STEPS.map((step, i) => (
                      <SegmentTick
                        key={step.title}
                        progress={scrollYProgress}
                        index={i}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative h-[340px]">
                {ASIDES.map((aside, i) => (
                  <StepAside
                    key={STEPS[i]?.title}
                    progress={scrollYProgress}
                    index={i}
                  >
                    {aside}
                  </StepAside>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto mt-14 flex max-w-[1440px] flex-col gap-16 px-5 sm:px-8 lg:px-10">
          <div className="flex justify-center">
            <PhoneFrame>
              <div className="absolute inset-0">{SCREENS[2]}</div>
            </PhoneFrame>
          </div>
          <ol className="flex flex-col gap-12">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <div className="flex items-center gap-4">
                  <span className="text-foreground font-mono text-xs font-medium">
                    0{i + 1}
                  </span>
                  <span className="bg-foreground block h-px w-12" />
                </div>
                <h3 className="text-foreground mt-5 text-3xl font-medium tracking-tight sm:text-4xl">
                  {step.title}
                </h3>
                <p className="text-muted-foreground mt-4 max-w-sm text-base leading-relaxed">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
