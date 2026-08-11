"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { EASE, Stagger } from "@/components/marketing/system";
import { cn } from "@/lib/utils";
import type { FaqItem } from "./faq-data";

/**
 * Accessible accordion: one item open at a time, animated height, full
 * button/region ARIA wiring. Reduced motion snaps instead of animating.
 */
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = React.useState<number | null>(0);

  return (
    <Stagger className="space-y-3" gap={0.06}>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            className={cn(
              "overflow-hidden rounded-2xl border bg-white transition-colors duration-300",
              isOpen
                ? "border-zinc-900/15 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
                : "border-zinc-900/[0.06] shadow-[0_2px_16px_rgba(15,23,42,0.04)]",
            )}
            key={item.q}
          >
            <h2>
              <button
                aria-controls={`faq-panel-${i}`}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center justify-between gap-6 px-6 py-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900"
                id={`faq-button-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                type="button"
              >
                <span className="font-display text-[17px] font-semibold tracking-tight text-zinc-900">
                  {item.q}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border border-zinc-900/10 text-zinc-500 transition-transform duration-300",
                    isOpen && "rotate-45",
                  )}
                >
                  <svg
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </button>
            </h2>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  animate={{ height: "auto", opacity: 1 }}
                  aria-labelledby={`faq-button-${i}`}
                  exit={{ height: 0, opacity: 0 }}
                  id={`faq-panel-${i}`}
                  initial={reduced ? false : { height: 0, opacity: 0 }}
                  role="region"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { duration: 0.4, ease: EASE }
                  }
                >
                  <p className="px-6 pb-6 text-[15px] leading-relaxed text-zinc-600">
                    {item.a}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </Stagger>
  );
}
