"use client";

import * as React from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";

import {
  CtaPill,
  EASE,
  GradientScene,
  Kicker,
  LogoRow,
  MockChat,
} from "@/components/marketing/system";

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
 * Reference-#1 hero: clean white left panel (kicker, staged headline, sub,
 * two pill CTAs, trusted-by row) beside a full-height sky gradient scene
 * with the floating agent chat card. Panels drift apart slightly on scroll.
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

  return (
    <section aria-label="Introduction" className="px-4 pt-24 md:px-6 md:pt-28">
      <div
        className="mx-auto grid max-w-[88rem] gap-4 lg:grid-cols-[1.05fr_1fr]"
        ref={ref}
      >
        {/* Left: the pitch */}
        <motion.div
          className="flex flex-col justify-center rounded-[2rem] border border-zinc-900/[0.06] bg-white px-8 py-14 shadow-[0_8px_40px_rgba(15,23,42,0.06)] md:px-14 md:py-20"
          style={reduced ? undefined : { y: yLeft }}
        >
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
              Describe your brand once. marketer.sh ideates, produces, and
              publishes video and SEO articles, and learns from every post.
            </p>
          </FadeUp>
          <FadeUp className="mt-9 flex flex-wrap items-center gap-3" delay={0.7}>
            <CtaPill href="/sign-up" size="lg">
              Start creating
            </CtaPill>
            <CtaPill href="/features" size="lg" variant="secondary">
              See how it works
            </CtaPill>
          </FadeUp>
          <FadeUp delay={0.85}>
            <LogoRow
              className="mt-14"
              names={[
                "Northbeam Studio",
                "Halide Labs",
                "Fern & Field",
                "Copperline",
              ]}
            />
          </FadeUp>
        </motion.div>

        {/* Right: the scene */}
        <motion.div style={reduced ? undefined : { y: yRight }}>
          <GradientScene
            className="relative flex min-h-[30rem] items-center justify-center rounded-[2rem] border border-zinc-900/[0.05] p-6 lg:min-h-full"
            variant="sky"
          >
            {/* Soft horizon blur, like depth of field on the reference photo */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-white/50 to-transparent"
            />
            <motion.div
              className="relative"
              style={reduced ? undefined : { y: yCard }}
            >
              <motion.div
                animate={reduced ? undefined : { y: [0, -8, 0] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              >
                <MockChat />
              </motion.div>
              {/* Status pill floating off the card */}
              <FadeUp
                className="absolute -bottom-5 -left-4 md:-left-10"
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
          </GradientScene>
        </motion.div>
      </div>
    </section>
  );
}
