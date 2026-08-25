"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  CtaPill,
  DisplayHeading,
  Lede,
} from "@/components/marketing/system";
import { cn } from "@/lib/utils";

function Rise({
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
      initial={reduced ? false : { opacity: 0, y: 20 }}
      transition={reduced ? { duration: 0 } : { duration: 0.7, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Shared hero for features pages. Cortex canvas: no kicker, no gradient
 * panel, large medium-weight type and two pill CTAs.
 */
export function FeatureHero({
  kicker: _kicker,
  title,
  titleText,
  lede,
  variant: _variant = "sky",
  highlight: _highlight,
  illustration,
  primary = { label: "Start creating", href: "/sign-up" },
  secondary = { label: "See pricing", href: "/pricing" },
  magneticPrimary: _magneticPrimary = false,
}: {
  kicker: string;
  title?: React.ReactNode;
  titleText?: string;
  lede: React.ReactNode;
  variant?: "sky" | "pearl" | "mist";
  /** Inner-page kit compatibility; unused on the Cortex canvas. */
  highlight?: string;
  illustration?: React.ReactNode;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
  magneticPrimary?: boolean;
}) {
  const split = Boolean(illustration);
  const heading = titleText ?? title;

  return (
    <section
      aria-label="Introduction"
      className="mx-auto max-w-[1440px] px-5 pt-28 sm:px-8 sm:pt-32 lg:px-10"
    >
      <div
        className={cn(
          "py-16 md:py-24",
          split
            ? "grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]"
            : "mx-auto max-w-3xl text-center",
        )}
      >
        <div>
          <Rise delay={0.12}>
            <DisplayHeading
              className={cn(!split && "mx-auto")}
              level={1}
              size="xl"
            >
              {heading}
            </DisplayHeading>
          </Rise>
          <Rise delay={0.28}>
            <Lede className={cn("mt-6", !split && "mx-auto")}>{lede}</Lede>
          </Rise>
          <Rise
            className={cn(
              "mt-9 flex flex-wrap items-center gap-3",
              !split && "justify-center",
            )}
            delay={0.42}
          >
            <CtaPill href={primary.href} size="lg">
              {primary.label}
            </CtaPill>
            <CtaPill href={secondary.href} size="lg" variant="secondary">
              {secondary.label}
            </CtaPill>
          </Rise>
        </div>
        {split ? (
          <Rise delay={0.36}>
            <div className="overflow-hidden rounded-3xl border border-border">
              {illustration}
            </div>
          </Rise>
        ) : null}
      </div>
    </section>
  );
}
