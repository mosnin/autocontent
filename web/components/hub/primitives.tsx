"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

export const HUB_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Shared motion + card primitives for the logged-in dashboards (the
 * reference-style hub language in light mode). Every product dashboard
 * composes these so the whole app breathes at one rhythm:
 *
 * - `<Rise>` — entrance: fade + 20px rise, optional delay for stagger.
 * - `<HubSection>` — section wrapper with a sparkle heading and staggered
 *   children entrances.
 * - `<HubPanel>` — the rounded-3xl light card chrome (non-link).
 * - `hubCardClass` — same chrome as a className, for Link/Card call sites.
 *
 * All primitives honor prefers-reduced-motion (opacity-only, no lift).
 */

export function Rise({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={reduced ? { opacity: 0, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: reduced ? 0.15 : 0.6, ease: HUB_EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Sparkle section heading, reference-style ("Bring any idea to life ✦"). */
export function HubHeading({
  children,
  className,
  as: Tag = "h2",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag
      className={cn(
        "flex items-center gap-2 font-semibold tracking-tight",
        Tag === "h1" ? "text-2xl md:text-[1.7rem]" : "text-xl",
        className,
      )}
    >
      {children}
      <Sparkles aria-hidden className="size-4 shrink-0 text-brand" />
    </Tag>
  );
}

/**
 * Section wrapper: sparkle heading + optional side actions, children rise
 * in with a small stagger. `index` offsets the whole section so stacked
 * sections cascade down the page.
 */
export function HubSection({
  title,
  actions,
  children,
  index = 0,
  className,
  ariaLabel,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Position of this section on the page, for cascade timing. */
  index?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const reduced = useReducedMotion();
  const base = reduced ? 0 : 0.07 * index;
  return (
    <section aria-label={ariaLabel} className={cn("space-y-4", className)}>
      {title ? (
        <Rise delay={base}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <HubHeading>{title}</HubHeading>
            {actions}
          </div>
        </Rise>
      ) : null}
      <Rise delay={base + (reduced ? 0 : 0.08)}>{children}</Rise>
    </section>
  );
}

/** The hub card chrome as a class, for Links, Cards, and panels. */
export const hubCardClass =
  "rounded-3xl border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.03),0_10px_32px_-20px_rgb(0_0_0/0.18)]";

/** Interactive variant: hover deepens the shadow (pair with HoverLift). */
export const hubCardHoverClass =
  "transition-shadow hover:shadow-[0_2px_4px_rgb(0_0_0/0.04),0_20px_48px_-20px_rgb(0_0_0/0.25)]";

/** Spring lift wrapper for interactive cards. */
export function HoverLift({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      whileHover={reduced ? undefined : { y: -4 }}
    >
      {children}
    </motion.div>
  );
}

/** Static hub panel (non-link): the rounded card with padded body. */
export function HubPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(hubCardClass, "p-5", className)}>{children}</div>;
}

/** Soft inner vignette frame for mini previews inside cards. */
export function VignetteFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60 bg-[linear-gradient(135deg,#fafafa,#f2f4f8)] p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
