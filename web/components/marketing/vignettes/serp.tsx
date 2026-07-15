import * as React from "react";

import { cn } from "@/lib/utils";
import { warmDot } from "@/components/marketing/system/accent";
import { MiniChip, MiniHeader, MiniPanel } from "./bits";

const RESULTS = [
  { titleW: "w-4/5", metaW: "w-3/5", tint: "bg-sky-200" },
  { titleW: "w-3/5", metaW: "w-2/5", tint: "bg-indigo-200" },
  { titleW: "w-2/3", metaW: "w-1/2", tint: "bg-violet-200" },
  { titleW: "w-1/2", metaW: "w-2/5", tint: "bg-rose-200" },
];

/**
 * A live SERP scan: four ranked result skeletons, then the finding —
 * a warm "gap found" callout naming the thin coverage.
 */
export function SerpVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[380px]", className)}>
      <MiniHeader meta='"best home espresso machine"' title="SERP scan" />
      <ul className="mt-3 space-y-1.5">
        {RESULTS.map((row, i) => (
          <li
            className="flex items-center gap-2.5 rounded-xl border border-zinc-900/[0.05] bg-white/80 px-3 py-2"
            key={i}
          >
            <span className="w-5 shrink-0 font-mono text-[10px] text-zinc-400">
              #{i + 1}
            </span>
            <span
              aria-hidden
              className={cn("size-3.5 shrink-0 rounded-full", row.tint)}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn("block h-1.5 rounded-full bg-zinc-200", row.titleW)}
              />
              <span
                className={cn(
                  "mt-1.5 block h-1 rounded-full bg-zinc-100",
                  row.metaW,
                )}
              />
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-start">
        <MiniChip tone="warm">
          <span className={cn("size-1.5 rounded-full", warmDot)} />
          Gap found · thin coverage under $800
        </MiniChip>
      </div>
    </MiniPanel>
  );
}
