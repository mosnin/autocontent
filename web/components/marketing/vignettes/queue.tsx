"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { MiniChip, MiniHeader, MiniPanel } from "./bits";

const ROWS = [
  {
    title: "3 grinder mistakes ruining your shots",
    channel: "YouTube Shorts",
    status: "Rendering",
    tone: "rendering" as const,
  },
  {
    title: "Dial in espresso in 60 seconds",
    channel: "TikTok",
    status: "Scheduled",
    tone: "scheduled" as const,
  },
  {
    title: "Why your milk won't stretch",
    channel: "Reels",
    status: "Published",
    tone: "published" as const,
  },
];

/** Pulsing brand recording dot (the one moving thing in this vignette). */
function RenderingDot() {
  const reduced = useReducedMotion();
  return (
    <span className="relative flex size-1.5">
      {!reduced && (
        <motion.span
          animate={{ scale: [1, 2], opacity: [0.5, 0] }}
          className="absolute inline-flex h-full w-full rounded-full bg-brand"
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
    </span>
  );
}

/**
 * The publish queue: three rows moving through render → schedule →
 * published, statuses on the right. Published wears the warm accent.
 */
export function QueueVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[380px]", className)}>
      <MiniHeader meta="updated 2 min ago" title="Publish queue" />
      <ul className="mt-3 space-y-2">
        {ROWS.map((row) => (
          <li
            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
            key={row.title}
          >
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-zinc-800">
                {row.title}
              </p>
              <p className="truncate text-[10.5px] text-zinc-400">
                {row.channel}
              </p>
            </div>
            <MiniChip tone={row.tone === "published" ? "warm" : "neutral"}>
              {row.tone === "rendering" && <RenderingDot />}
              {row.status}
            </MiniChip>
          </li>
        ))}
      </ul>
    </MiniPanel>
  );
}
