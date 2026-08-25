"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { DisplayHeading, Lede } from "@/components/marketing/system";
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
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      transition={reduced ? { duration: 0 } : { duration: 0.7, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Shared sub-page hero: large medium-weight title on the Cortex canvas.
 * Owns the page's single <h1>.
 */
export function PageHero({
  kicker: _kicker,
  headline,
  sub,
  variant: _variant = "sky",
  highlight: _highlight,
  size = "lg",
  children,
  className,
}: {
  kicker: string;
  headline: string;
  sub?: string;
  variant?: "sky" | "pearl" | "mist";
  /** Inner-page kit compatibility; unused on the Cortex canvas. */
  highlight?: string;
  size?: "xl" | "lg";
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="Introduction"
      className={cn(
        "mx-auto max-w-[1440px] px-5 pt-28 sm:px-8 sm:pt-32 lg:px-10",
        className,
      )}
    >
      <div className="mx-auto max-w-3xl py-16 text-center md:py-24">
        <FadeUp delay={0.12}>
          <DisplayHeading className="mx-auto" level={1} size={size}>
            {headline}
          </DisplayHeading>
        </FadeUp>
        {sub ? (
          <FadeUp delay={0.28}>
            <Lede className="mx-auto mt-6 max-w-2xl">{sub}</Lede>
          </FadeUp>
        ) : null}
        {children ? <FadeUp delay={0.42}>{children}</FadeUp> : null}
      </div>
    </section>
  );
}
