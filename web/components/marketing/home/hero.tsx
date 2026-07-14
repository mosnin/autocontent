"use client";

import * as React from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";

import {
  CtaPill,
  EASE,
  GradientScene,
  Kicker,
  LogoRow,
  MockChat,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

const HEADLINE_LINES = ["Marketing that", "runs itself."];

function StagedLine({ line, index }: { line: string; index: number }) {
  const reduced = useReducedMotion();
  if (reduced) {
    return <span className="block">{line}</span>;
  }
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      <motion.span
        animate={{ y: 0 }}
        className="block"
        initial={{ y: "110%" }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.25 + index * 0.12 }}
      >
        {line}
      </motion.span>
    </span>
  );
}

function FadeUp({
  children,
  delay,
  className,
}: {
  children: React.ReactNode;
  delay: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A large soft bloom of color, drifting slowly. Outer layer takes the
 * scroll parallax, inner layer takes the idle drift loop.
 */
function BloomOrb({
  className,
  toneClassName,
  parallax,
  drift = 14,
  duration = 16,
}: {
  /** Position and size of the orb. */
  className?: string;
  /** The radial gradient fill. */
  toneClassName?: string;
  parallax?: MotionValue<number>;
  drift?: number;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={reduced ? undefined : { y: parallax }}
    >
      <motion.div
        animate={reduced ? undefined : { x: [0, drift, 0], y: [0, -drift, 0] }}
        className={cn("size-full rounded-full", toneClassName)}
        transition={{ duration, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.div>
  );
}

/** Mini queue chip: the next scheduled post, floating behind the chat card. */
function ScheduledChip() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/50 bg-white/70 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <span
        aria-hidden
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-900/[0.05] text-zinc-500"
      >
        <svg
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
      <div>
        <p className="text-[12px] font-medium leading-tight text-zinc-800">
          Tonight 9:00 PM
        </p>
        <p className="text-[11px] leading-tight text-zinc-400">
          espresso short · scheduled
        </p>
      </div>
    </div>
  );
}

/**
 * Reference-#1 hero: clean white left panel (kicker, staged headline, sub,
 * two pill CTAs, trusted-by row) beside a full-height sky gradient scene.
 * The scene is layered for depth: drifting bloom orbs, a faint dot grid,
 * a scheduled-post chip behind the chat card, and a quiet queue caption.
 * Layers parallax slightly against scroll; everything reduced-motion gated.
 */
export function Hero() {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yLeft = useTransform(scrollYProgress, [0, 1], [0, -24]);
  const yRight = useTransform(scrollYProgress, [0, 1], [0, 36]);
  const yCard = useTransform(scrollYProgress, [0, 1], [0, -30]);
  const yChip = useTransform(scrollYProgress, [0, 1], [0, -18]);
  const yOrbA = useTransform(scrollYProgress, [0, 1], [0, 26]);
  const yOrbB = useTransform(scrollYProgress, [0, 1], [0, -22]);
  const yOrbC = useTransform(scrollYProgress, [0, 1], [0, 14]);
  const yGrid = useTransform(scrollYProgress, [0, 1], [0, 20]);

  return (
    <section aria-label="Introduction" className="px-4 pt-24 md:px-6 md:pt-28">
      <div
        className="mx-auto grid max-w-[88rem] gap-4 lg:grid-cols-[1.05fr_1fr]"
        ref={ref}
      >
        {/* Left: the pitch, vertically centered in its panel */}
        <motion.div
          className="flex rounded-[2rem] border border-zinc-900/[0.06] bg-white px-8 py-14 shadow-[0_8px_40px_rgba(15,23,42,0.06)] md:px-14 md:py-16"
          style={reduced ? undefined : { y: yLeft }}
        >
          <div className="my-auto w-full">
            <FadeUp delay={0.1}>
              <Kicker>The autonomous marketing platform</Kicker>
            </FadeUp>
            <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.02] tracking-tight text-zinc-900 md:text-6xl lg:text-7xl">
              {HEADLINE_LINES.map((line, i) => (
                <StagedLine index={i} key={line} line={line} />
              ))}
            </h1>
            <FadeUp delay={0.55}>
              <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-zinc-600">
                Describe your brand once. marketer.sh writes, renders, and
                posts video and SEO articles on schedule. Your first short
                costs about fifty cents.
              </p>
            </FadeUp>
            <FadeUp
              className="mt-9 flex flex-wrap items-center gap-3"
              delay={0.7}
            >
              <CtaPill href="/sign-up" size="lg">
                Start creating
              </CtaPill>
              <CtaPill href="/features" size="lg" variant="secondary">
                See how it works
              </CtaPill>
            </FadeUp>
            <FadeUp delay={0.85}>
              <LogoRow
                className="mt-12"
                names={[
                  "Northbeam Studio",
                  "Halide Labs",
                  "Fern & Field",
                  "Copperline",
                ]}
              />
            </FadeUp>
          </div>
        </motion.div>

        {/* Right: the scene */}
        <motion.div style={reduced ? undefined : { y: yRight }}>
          <GradientScene
            className="relative flex min-h-[32rem] items-center justify-center rounded-[2rem] border border-zinc-900/[0.05] p-6 lg:min-h-full"
            variant="sky"
          >
            {/* Depth layer: large soft blooms drifting behind the cards */}
            <BloomOrb
              className="-top-28 -right-24 size-[26rem]"
              drift={16}
              duration={18}
              parallax={reduced ? undefined : yOrbA}
              toneClassName="bg-[radial-gradient(circle_at_center,rgba(96,165,250,0.30),transparent_65%)] blur-2xl"
            />
            <BloomOrb
              className="-bottom-32 -left-28 size-[28rem]"
              drift={12}
              duration={22}
              parallax={reduced ? undefined : yOrbB}
              toneClassName="bg-[radial-gradient(circle_at_center,rgba(129,140,248,0.22),transparent_65%)] blur-2xl"
            />
            <BloomOrb
              className="top-1/3 -left-12 size-56"
              drift={10}
              duration={14}
              parallax={reduced ? undefined : yOrbC}
              toneClassName="bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.65),transparent_70%)] blur-xl"
            />

            {/* Depth layer: faint dot-grid texture */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute right-8 top-10 h-44 w-64 opacity-60 [background-image:radial-gradient(circle,rgba(24,24,27,0.14)_1px,transparent_1.5px)] [background-size:14px_14px] [mask-image:radial-gradient(closest-side,black,transparent)]"
              style={reduced ? undefined : { y: yGrid }}
            />

            {/* Soft horizon blur, like depth of field on the reference photo */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-white/50 to-transparent"
            />

            <motion.div
              className="relative"
              style={reduced ? undefined : { y: yCard }}
            >
              {/* Scheduled-post chip, layered behind and above the card */}
              <motion.div
                className="absolute -top-14 right-2 z-0 w-max md:-right-10"
                style={reduced ? undefined : { y: yChip }}
              >
                <FadeUp delay={1.0}>
                  <motion.div
                    animate={reduced ? undefined : { y: [0, -6, 0] }}
                    transition={{
                      duration: 6,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 1.4,
                    }}
                  >
                    <ScheduledChip />
                  </motion.div>
                </FadeUp>
              </motion.div>

              <motion.div
                animate={reduced ? undefined : { y: [0, -8, 0] }}
                className="relative z-10"
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              >
                <MockChat />
              </motion.div>

              {/* Status pill floating off the card */}
              <FadeUp
                className="absolute -bottom-5 -left-4 z-20 md:-left-10"
                delay={1.1}
              >
                <span className="inline-flex items-center gap-2 rounded-full border border-white/50 bg-white/80 px-3.5 py-2 text-xs font-medium text-zinc-700 shadow-[0_8px_24px_rgba(15,23,42,0.10)] backdrop-blur-xl">
                  <span className="relative flex size-2">
                    {!reduced && (
                      <motion.span
                        animate={{ scale: [1, 1.9], opacity: [0.5, 0] }}
                        className="absolute inline-flex h-full w-full rounded-full bg-brand"
                        transition={{
                          duration: 1.6,
                          repeat: Infinity,
                          ease: "easeOut",
                        }}
                      />
                    )}
                    <span className="relative inline-flex size-2 rounded-full bg-brand" />
                  </span>
                  Rendering… <span className="font-mono tabular-nums">00:42</span>
                </span>
              </FadeUp>
            </motion.div>

            {/* Quiet caption, bottom-left of the scene */}
            <FadeUp
              className="absolute bottom-5 left-7 z-10 md:bottom-7 md:left-9"
              delay={1.25}
            >
              <p className="max-w-[15rem] text-xs leading-relaxed text-zinc-500">
                Live from the queue. Every render reported as it happens.
              </p>
            </FadeUp>
          </GradientScene>
        </motion.div>
      </div>
    </section>
  );
}
