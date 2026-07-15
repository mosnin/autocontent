"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { GlassPanel } from "@/components/marketing/system";
import { EASE } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";
import { MiniPill, MockHeader } from "./bits";

const CLIENTS = [
  {
    niche: "bright-smile-dental",
    spent: "$4.20",
    cap: "$6 cap",
    width: "70%",
    gate: "Gate on",
    gateTone: "live" as const,
  },
  {
    niche: "ridgeline-realty",
    spent: "$3.40",
    cap: "$8 cap",
    width: "42%",
    gate: "Gate on",
    gateTone: "live" as const,
  },
  {
    niche: "luna-yoga",
    spent: "$1.10",
    cap: "$5 cap",
    width: "22%",
    gate: "Autopilot",
    gateTone: "ok" as const,
  },
];

/**
 * Agencies product moment: every client is its own niche with its own
 * daily cap and gate, all under one global cap, ready for the ledger.
 */
export function AgenciesDashboardMock({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <GlassPanel className={cn("w-full max-w-sm p-5", className)}>
      <MockHeader
        chip={<MiniPill>Global cap $40/day</MiniPill>}
        title="Client niches"
      />
      <ul className="mt-4 space-y-2">
        {CLIENTS.map((c, i) => (
          <li
            className="rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-3"
            key={c.niche}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="truncate font-mono text-[12px] font-medium text-zinc-700">
                {c.niche}
              </p>
              <MiniPill tone={c.gateTone}>{c.gate}</MiniPill>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-900/[0.06]">
                <motion.span
                  className="block h-full rounded-full bg-indigo-400/70"
                  initial={reduced ? { width: c.width } : { width: 0 }}
                  transition={{
                    duration: 0.9,
                    ease: EASE,
                    delay: 0.3 + i * 0.15,
                  }}
                  viewport={{ once: true, margin: "-40px" }}
                  whileInView={{ width: c.width }}
                />
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-500">
                {c.spent} <span className="text-zinc-400">/ {c.cap}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between border-t border-zinc-900/[0.06] pt-4">
        <span className="text-[11px] font-medium text-zinc-500">
          Spend ledger, per client
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-900/10 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-zinc-700">
          Export June
          <svg
            aria-hidden
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M12 5v14" />
            <path d="m6 13 6 6 6-6" />
          </svg>
        </span>
      </div>
    </GlassPanel>
  );
}
