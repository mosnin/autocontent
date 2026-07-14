"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  DisplayHeading,
  EASE,
  GradientScene,
  Kicker,
  Lede,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

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
 * Shared sub-page hero for Resources / Company / Pricing: a soft gradient
 * panel with a staged kicker → h1 → standfirst entrance on load.
 * Owns the page's single <h1>.
 */
export function PageHero({
  kicker,
  headline,
  sub,
  variant = "sky",
  size = "lg",
  children,
  className,
}: {
  kicker: string;
  headline: string;
  sub?: string;
  variant?: "sky" | "pearl" | "mist";
  size?: "xl" | "lg";
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="Introduction"
      className={cn("px-4 pt-24 md:px-6 md:pt-28", className)}
    >
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant={variant}
      >
        <div className="mx-auto max-w-6xl px-6 py-20 text-center md:py-28">
          <FadeUp delay={0.1}>
            <Kicker>{kicker}</Kicker>
          </FadeUp>
          <FadeUp delay={0.22}>
            <DisplayHeading className="mx-auto mt-5 max-w-3xl" level={1} size={size}>
              {headline}
            </DisplayHeading>
          </FadeUp>
          {sub ? (
            <FadeUp delay={0.4}>
              <Lede className="mx-auto mt-6 max-w-2xl">{sub}</Lede>
            </FadeUp>
          ) : null}
          {children ? <FadeUp delay={0.55}>{children}</FadeUp> : null}
        </div>
      </GradientScene>
    </section>
  );
}
