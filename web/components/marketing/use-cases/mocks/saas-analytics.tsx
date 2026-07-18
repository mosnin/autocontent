"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { GlassPanel } from "@/components/marketing/system";
import { EASE } from "@/components/marketing/system/motion";
import { cn } from "@/lib/utils";
import { MiniPill, MockHeader } from "./bits";

const METRICS = [
  { label: "Hook retention", value: "82%", width: "82%" },
  { label: "Watched to end", value: "41%", width: "41%" },
  { label: "Profile visits", value: "+312", width: "64%" },
];

const NEXT_IDEAS = [
  { title: "Branching for staging environments", format: "Short" },
  { title: "Neon vs. RDS for side projects", format: "Article" },
];

/**
 * SaaS product moment: a published post's metrics flowing straight into
 * the next ideation round. The loop, on one card.
 */
export function SaasAnalyticsMock({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  return (
    <GlassPanel className={cn("w-full max-w-sm p-5", className)}>
      <MockHeader chip={<MiniPill>devtools channel</MiniPill>} title="Post performance" />

      <div className="mt-4 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[13px] font-medium text-zinc-800">
            Postgres branching, explained in 40s
          </p>
          <MiniPill tone="ok">Published</MiniPill>
        </div>
        <div className="mt-3 space-y-2">
          {METRICS.map((m, i) => (
            <div className="flex items-center gap-2" key={m.label}>
              <span className="w-24 shrink-0 text-[11px] text-zinc-400">
                {m.label}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-900/[0.06]">
                <motion.span
                  className="block h-full rounded-full bg-sky-400/70"
                  initial={reduced ? { width: m.width } : { width: 0 }}
                  transition={{
                    duration: 0.9,
                    ease: EASE,
                    delay: 0.3 + i * 0.15,
                  }}
                  viewport={{ once: true, margin: "-40px" }}
                  whileInView={{ width: m.width }}
                />
              </span>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-600">
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-400">
        <svg
          aria-hidden
          className="size-3.5"
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
        Feeds next ideation
      </div>

      <ul className="mt-2 space-y-2">
        {NEXT_IDEAS.map((idea) => (
          <li
            className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-900/10 bg-white/60 px-3.5 py-2.5"
            key={idea.title}
          >
            <p className="truncate text-[13px] text-zinc-700">{idea.title}</p>
            <MiniPill>{idea.format}</MiniPill>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
