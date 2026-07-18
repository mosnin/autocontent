"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { GlassPanel } from "@/components/marketing/system";
import { EASE } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";
import { MiniPill, PulseDot } from "./bits";

type Turn =
  | { kind: "bubble"; from: "user" | "agent"; text: string }
  | { kind: "tool"; call: string; note: string };

const TURNS: Turn[] = [
  {
    kind: "bubble",
    from: "user",
    text: "Launch a content push for the new feature.",
  },
  {
    kind: "tool",
    call: "marketer.queue_video × 3",
    note: "est $2.90 · cap ok",
  },
  {
    kind: "tool",
    call: "marketer.queue_article × 2",
    note: "est $1.30 · cap ok",
  },
  {
    kind: "bubble",
    from: "agent",
    text: "Created channel, queued 3 videos + 2 articles. Est. $4.20, cap $10. Awaiting your approval gate.",
  },
];

/**
 * The flagship product moment: an agent driving marketer.sh over MCP.
 * iMessage-style glass bubbles with the tool calls, costs, and cap
 * checks shown inline.
 */
export function AgentChatMock({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <GlassPanel className={cn("w-full max-w-sm p-5", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-900/[0.06] pb-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-200 to-indigo-200 ring-1 ring-white/80"
          >
            <span className="size-2 rounded-full bg-zinc-900/70" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-zinc-900">
              your ops agent
            </p>
            <p className="font-mono text-[11px] text-zinc-400">
              mcp · pat: launch-* scope
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-900/10 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-zinc-500">
          <PulseDot />
          working
        </span>
      </div>

      <motion.ul
        className="mt-4 space-y-2.5"
        initial={reduced ? false : "hidden"}
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.35, delayChildren: 0.3 } },
        }}
        viewport={{ once: true, margin: "-40px" }}
        whileInView="show"
      >
        {TURNS.map((t, i) => (
          <motion.li
            className={cn(
              "flex",
              t.kind === "bubble" && t.from === "user" && "justify-end",
              t.kind === "tool" && "justify-center",
            )}
            key={i}
            variants={{
              hidden: { opacity: 0, y: 10, scale: 0.98 },
              show: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { duration: 0.45, ease: EASE },
              },
            }}
          >
            {t.kind === "bubble" ? (
              <p
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug",
                  t.from === "agent"
                    ? "rounded-bl-md border border-zinc-900/[0.06] bg-white text-zinc-700 shadow-sm"
                    : "rounded-br-md bg-zinc-900 text-white",
                )}
              >
                {t.text}
              </p>
            ) : (
              <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-zinc-900/[0.06] bg-white/60 px-3 py-1.5">
                <code className="truncate font-mono text-[11px] text-zinc-600">
                  {t.call}
                </code>
                <span className="shrink-0 font-mono text-[10px] text-amber-600">
                  {t.note}
                </span>
              </span>
            )}
          </motion.li>
        ))}
      </motion.ul>

      <div className="mt-4 flex items-center justify-between border-t border-zinc-900/[0.06] pt-4">
        <span className="font-mono text-[11px] tabular-nums text-zinc-500">
          queued est. $4.20 · cap $10.00
        </span>
        <MiniPill tone="wait">Gate: awaiting you</MiniPill>
      </div>
    </GlassPanel>
  );
}
