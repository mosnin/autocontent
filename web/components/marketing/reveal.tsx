"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * In-view reveal: content rises 16px and fades in the first time it enters
 * the viewport. Honors prefers-reduced-motion. Use for section headers and
 * list items; keep `delay` under ~0.3s so the page never feels gated.
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

  // Under reduced motion, keep the motion element mounted and drive it to
  // the visible state via `animate` on mount. Branching to a plain <div>
  // would strand the SSR-rendered `opacity:0` inline style on the hydrated
  // node (useReducedMotion is false during SSR), blanking content for
  // reduced-motion users.
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
      initial={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.55, ease: [0.21, 0.47, 0.32, 0.98], delay }}
      viewport={{ once: true, margin: "-80px" }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}
