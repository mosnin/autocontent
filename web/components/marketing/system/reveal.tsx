"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE, REVEAL_DURATION, VIEWPORT } from "./motion";

/**
 * In-view reveal: content rises 24px and fades in the first time it enters
 * the viewport. Honors prefers-reduced-motion (renders static).
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
    return <div className={className}>{children}</div>;
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
 * a grid/flex container. Reduced motion renders everything static.
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
          <div className={itemClassName} key={i}>
            {child}
          </div>
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
