"use client";

import { softEase, useReducedMotion } from "@/lib/marketing/motion";
import { motion } from "motion/react";
import type { ReactNode } from "react";

export function MenuIcon({ open }: { open: boolean }): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const transition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.4, ease: softEase };

  return (
    <span
      className="relative grid h-4 w-4 place-items-center"
      aria-hidden="true"
    >
      <motion.span
        className="col-start-1 row-start-1 h-[1.6px] w-[15px] rounded-full bg-current"
        initial={false}
        animate={{ y: open ? 0 : -3, rotate: open ? 45 : 0 }}
        transition={transition}
      />
      <motion.span
        className="col-start-1 row-start-1 h-[1.6px] w-[15px] rounded-full bg-current"
        initial={false}
        animate={{ y: open ? 0 : 3, rotate: open ? -45 : 0 }}
        transition={transition}
      />
    </span>
  );
}
