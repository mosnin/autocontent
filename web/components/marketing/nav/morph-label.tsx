"use client";

import { softEase, useReducedMotion } from "@/lib/marketing/motion";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

export function MorphLabel({ value }: { value: string }): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const minWidth = `${Math.max(value.length, 5)}ch`;

  if (prefersReducedMotion) {
    return (
      <span className="inline-block" style={{ minWidth }}>
        {value}
      </span>
    );
  }

  return (
    <span
      className="relative grid items-center overflow-hidden"
      style={{ minWidth }}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.28, ease: softEase }}
          aria-hidden="true"
          className="col-start-1 row-start-1 text-left whitespace-nowrap"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
