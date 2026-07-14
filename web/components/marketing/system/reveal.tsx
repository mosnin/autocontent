"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, REVEAL_DURATION, VIEWPORT } from "./motion";

/**
 * In-view reveal: content rises 24px and fades in the first time it enters
 * the viewport. Honors prefers-reduced-motion.
 *
 * Reduced motion never branches to a plain <div>. `useReducedMotion()`
 * returns false during SSR, so the server renders the motion element with
 * `opacity:0`; if the client then swapped in a plain <div>, React reuses
 * the hydrated node and leaves that stale inline style in place, blanking
 * the section forever for reduced-motion users. Instead we keep the motion
 * element mounted and, when reduced, drive it to the visible state on mount
 * via `animate` (which motion always applies), overwriting the SSR style.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={cn(className)}
        initial={false}
        transition={{ duration: 0 }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={cn(className)}
      initial={{ opacity: 0, y: 24 }}
      transition={{ duration: REVEAL_DURATION, ease: EASE, delay }}
      viewport={VIEWPORT}
      whileInView={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered in-view reveal: each direct child rises and fades with a small
 * offset. Children are wrapped in plain divs, so `className` works fine as
 * a grid/flex container. Reduced motion renders everything visible (see
 * Reveal for why we do not branch to plain divs).
 */
export function Stagger({
  children,
  className,
  delay = 0,
  gap = 0.08,
  itemClassName,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /** Seconds between each child's entrance. Spec range: 0.06-0.1. */
  gap?: number;
  itemClassName?: string;
}) {
  const reduced = useReducedMotion();
  const items = React.Children.toArray(children);

  if (reduced) {
    return (
      <div className={className}>
        {items.map((child, i) => (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={itemClassName}
            initial={false}
            key={i}
            transition={{ duration: 0 }}
          >
            {child}
          </motion.div>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay } },
      }}
      viewport={VIEWPORT}
      whileInView="show"
    >
      {items.map((child, i) => (
        <motion.div
          className={itemClassName}
          key={i}
          variants={{
            hidden: { opacity: 0, y: 24 },
            show: {
              opacity: 1,
              y: 0,
              transition: { duration: REVEAL_DURATION, ease: EASE },
            },
          }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
