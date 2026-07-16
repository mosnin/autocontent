"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { warmText } from "@/components/marketing/system/accent";

/**
 * The CLI at work — the one dark vignette in the library. A generate
 * command, a working spinner line, and the warm queued confirmation.
 */
export function TerminalVignette({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[380px] rounded-2xl border border-white/10 bg-zinc-900 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.35)]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className="ml-auto font-mono text-[10px] text-zinc-500">
          marketer - zsh
        </span>
      </div>
      <div className="mt-3 space-y-1.5 font-mono text-[11px] leading-relaxed">
        <p className="text-zinc-100">
          <span className="text-zinc-500">$ </span>
          marketer articles generate{" "}
          <span className="text-zinc-400">--niche</span>{" "}
          <span className="text-sky-300">&quot;home espresso&quot;</span>
        </p>
        <p className="text-zinc-400">
          {reduced ? (
            <span aria-hidden>⠋ </span>
          ) : (
            <motion.span
              animate={{ opacity: [1, 0.25, 1] }}
              aria-hidden
              className="inline-block"
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              ⠋{" "}
            </motion.span>
          )}
          researching live SERP · outlining
        </p>
        <p>
          <span className={cn("font-medium", warmText)}>
            ✓ queued 4 drafts · est $1.24
          </span>
        </p>
      </div>
    </div>
  );
}
