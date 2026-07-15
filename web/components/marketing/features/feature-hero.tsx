"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  CtaPill,
  DisplayHeading,
  EASE,
  GradientScene,
  Kicker,
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
  // Always mount the motion element: the plain-div branch leaves motion's
  // SSR'd opacity:0 inline style on the hydrated DOM (React skips the stale
  // attribute), blanking content for prefers-reduced-motion users.
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={reduced ? false : { opacity: 0, y: 20 }}
      transition={reduced ? { duration: 0 } : { duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Shared hero for the features pages: staged kicker → h1 → lede → CTAs on a
 * soft gradient panel. With `illustration` it splits into a two-column
 * scene; without it the copy sits centered. Owns the page's single h1.
 */
export function FeatureHero({
  kicker,
  title,
  lede,
  variant = "sky",
  illustration,
  primary = { label: "Start creating", href: "/sign-up" },
  secondary = { label: "See pricing", href: "/pricing" },
}: {
  kicker: string;
  title: React.ReactNode;
  lede: React.ReactNode;
  variant?: "sky" | "pearl" | "mist";
  illustration?: React.ReactNode;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  const split = Boolean(illustration);

  return (
    <section aria-label="Introduction" className="px-4 pt-24 md:px-6 md:pt-28">
      <GradientScene
        className="mx-auto max-w-[88rem] rounded-[2.5rem] border border-zinc-900/[0.05]"
        variant={variant}
      >
        <div
          className={cn(
            "mx-auto max-w-6xl px-6 py-20 md:py-28",
            split
              ? "grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]"
              : "text-center",
          )}
        >
          <div className={cn(!split && "mx-auto max-w-3xl")}>
            <Rise delay={0.1}>
              <Kicker>{kicker}</Kicker>
            </Rise>
            <Rise delay={0.22}>
              <DisplayHeading
                className={cn("mt-5", !split && "mx-auto")}
                level={1}
                size="xl"
              >
                {title}
              </DisplayHeading>
            </Rise>
            <Rise delay={0.4}>
              <Lede className={cn("mt-6", !split && "mx-auto")}>{lede}</Lede>
            </Rise>
            <Rise
              className={cn(
                "mt-9 flex flex-wrap items-center gap-3",
                !split && "justify-center",
              )}
              delay={0.55}
            >
              <CtaPill href={primary.href} size="lg">
                {primary.label}
              </CtaPill>
              <CtaPill href={secondary.href} size="lg" variant="secondary">
                {secondary.label}
              </CtaPill>
            </Rise>
          </div>
          {split ? <Rise delay={0.45}>{illustration}</Rise> : null}
        </div>
      </GradientScene>
    </section>
  );
}
