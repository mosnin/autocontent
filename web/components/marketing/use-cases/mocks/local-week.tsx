"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { GlassPanel } from "@/components/marketing/system";
import { EASE } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";
import { MiniPill, MockHeader } from "./bits";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Which days carry a post this week (index into DAYS). */
const POSTED = new Set([1, 3, 5]);

const WEEK_POSTS = [
  {
    day: "Tue",
    title: "Behind the bar at 6 a.m.",
    kind: "Reel",
  },
  {
    day: "Thu",
    title: "How we dial in the day's roast",
    kind: "Short",
  },
  {
    day: "Sat",
    title: "Best cafes to work from in Salem",
    kind: "Article",
  },
];

/**
 * Local-business product moment: the week at a glance. Three posts
 * scheduled, reviewed once, done by Sunday close.
 */
export function LocalWeekMock({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <GlassPanel className={cn("w-full max-w-sm p-5", className)}>
      <MockHeader chip={<MiniPill>Harbor Coffee</MiniPill>} title="This week" />

      <motion.div
        className="mt-4 grid grid-cols-7 gap-1.5"
        initial={reduced ? false : "hidden"}
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } },
        }}
        viewport={{ once: true, margin: "-40px" }}
        whileInView="show"
      >
        {DAYS.map((day, i) => (
          <motion.div
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg border py-2",
              POSTED.has(i)
                ? "border-zinc-900/[0.08] bg-white"
                : "border-zinc-900/[0.04] bg-white/50",
            )}
            key={day}
            variants={{
              hidden: { opacity: 0, y: 8 },
              show: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.4, ease: EASE },
              },
            }}
          >
            <span className="text-[10px] font-medium text-zinc-400">{day}</span>
            <span
              className={cn(
                "size-1.5 rounded-full",
                POSTED.has(i) ? "bg-brand" : "bg-zinc-200",
              )}
            />
          </motion.div>
        ))}
      </motion.div>

      <ul className="mt-4 space-y-2">
        {WEEK_POSTS.map((p) => (
          <li
            className="flex items-center gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-2.5"
            key={p.title}
          >
            <span className="w-8 shrink-0 text-[11px] font-medium text-zinc-400">
              {p.day}
            </span>
            <p className="min-w-0 flex-1 truncate text-[13px] text-zinc-700">
              {p.title}
            </p>
            <MiniPill>{p.kind}</MiniPill>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between border-t border-zinc-900/[0.06] pt-4">
        <span className="text-[11px] font-medium text-zinc-500">
          One review, Sunday evening
        </span>
        <MiniPill tone="ok">Week approved</MiniPill>
      </div>
    </GlassPanel>
  );
}
