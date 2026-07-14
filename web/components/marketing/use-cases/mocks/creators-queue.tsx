"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { GlassPanel } from "@/components/marketing/system";
import { EASE } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";
import { MiniPill, MockHeader } from "./bits";

const POSTS = [
  {
    time: "7:30 PM",
    title: "The kingdom that banned mirrors",
    channel: "TikTok",
    tone: "ok" as const,
    status: "Approved",
  },
  {
    time: "9:00 PM",
    title: "Why the map lies, part 2",
    channel: "YouTube Shorts",
    tone: "wait" as const,
    status: "Your review",
  },
  {
    time: "10:30 PM",
    title: "The lighthouse keeper's ledger",
    channel: "Reels",
    tone: "neutral" as const,
    status: "Scheduled",
  },
];

/**
 * Creators product moment: tonight's queue for a faceless channel.
 * Three scheduled posts, one still waiting on the approval gate, and the
 * locked character sheet keeping the world consistent.
 */
export function CreatorsQueueMock({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <GlassPanel className={cn("w-full max-w-sm p-5", className)}>
      <MockHeader
        chip={<MiniPill>cozy-fantasy-lore</MiniPill>}
        title="Tonight's queue"
      />
      <motion.ul
        className="mt-4 space-y-2"
        initial={reduced ? false : "hidden"}
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.14, delayChildren: 0.2 } },
        }}
        viewport={{ once: true, margin: "-40px" }}
        whileInView="show"
      >
        {POSTS.map((p) => (
          <motion.li
            className="flex items-center gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-3"
            key={p.title}
            variants={{
              hidden: { opacity: 0, y: 10 },
              show: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.45, ease: EASE },
              },
            }}
          >
            <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
              {p.time}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-zinc-800">
                {p.title}
              </p>
              <p className="text-[11px] text-zinc-400">{p.channel}</p>
            </div>
            <MiniPill tone={p.tone}>{p.status}</MiniPill>
          </motion.li>
        ))}
      </motion.ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-900/[0.06] pt-4">
        <span className="inline-flex items-center gap-2 text-[11px] font-medium text-zinc-500">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-200 to-violet-200 ring-1 ring-white/80"
          >
            <span className="size-1.5 rounded-full bg-zinc-900/60" />
          </span>
          Character: Mara, sheet locked
        </span>
        <MiniPill tone="live">Approval gate on</MiniPill>
      </div>
    </GlassPanel>
  );
}
