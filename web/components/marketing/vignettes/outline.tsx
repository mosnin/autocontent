import * as React from "react";

import { cn } from "@/lib/utils";
import { warmDot } from "@/components/marketing/system/accent";
import { MiniChip, MiniHeader, MiniPanel } from "./bits";

const SECTIONS = [
  { level: "H1", label: "Best home espresso machines under $800", status: "done" as const },
  { level: "H2", label: "How we tested: 400 shots, 9 machines", status: "done" as const },
  { level: "H2", label: "Best overall: the Breville Bambino Plus", status: "done" as const },
  { level: "H2", label: "Best for small counters", status: "writing" as const },
  { level: "H2", label: "What we'd skip and why", status: "queued" as const },
];

/**
 * The structured outline mid-draft: one H1, a run of H2s, each section
 * carrying its own status as parallel drafting works through the list.
 */
export function OutlineVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[400px]", className)}>
      <MiniHeader meta="1 H1 · 6 H2s" title="Outline" />
      <ul className="mt-3 space-y-1.5">
        {SECTIONS.map((s) => (
          <li
            className={cn(
              "flex items-center gap-2.5 rounded-xl border px-3 py-2",
              s.level === "H1"
                ? "border-zinc-900/10 bg-zinc-900/[0.03]"
                : "border-zinc-900/[0.05] bg-white/80",
            )}
            key={s.label}
          >
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9.5px] font-semibold",
                s.level === "H1"
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-900/[0.06] text-zinc-500",
              )}
            >
              {s.level}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-700">
              {s.label}
            </span>
            {s.status === "done" && (
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", warmDot)} />
            )}
            {s.status === "writing" && (
              <span className="shrink-0 text-[10px] font-medium text-sky-600">
                writing
              </span>
            )}
            {s.status === "queued" && (
              <span className="shrink-0 text-[10px] text-zinc-300">queued</span>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-start">
        <MiniChip tone="neutral">3 sections drafting in parallel</MiniChip>
      </div>
    </MiniPanel>
  );
}
