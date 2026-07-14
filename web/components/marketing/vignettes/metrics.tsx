import * as React from "react";

import { cn } from "@/lib/utils";
import { MiniChip, MiniHeader, MiniPanel } from "./bits";

const LINE_D =
  "M 10 78 C 46 72 70 76 102 60 C 134 44 160 46 196 34 C 232 22 268 24 306 14";

/**
 * The performance readout: retention line rising in ink, latest post
 * highlighted with a warm point, views and completion chips below.
 */
export function MetricsVignette({ className }: { className?: string }) {
  const id = React.useId();

  return (
    <MiniPanel className={cn("mx-auto max-w-[380px]", className)}>
      <MiniHeader meta="last 14 posts" title="Retention" />
      <svg
        aria-label="Line chart of retention rising across recent posts, latest post highlighted"
        className="mt-3 block h-auto w-full"
        role="img"
        viewBox="0 0 320 92"
      >
        <defs>
          <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#eff6ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[24, 50, 76].map((y) => (
          <line
            className="stroke-zinc-100"
            key={y}
            strokeWidth={1}
            x1={10}
            x2={310}
            y1={y}
            y2={y}
          />
        ))}
        <path d={`${LINE_D} L 306 86 L 10 86 Z`} fill={`url(#${id}-area)`} />
        <path
          className="stroke-zinc-800"
          d={LINE_D}
          fill="none"
          strokeLinecap="round"
          strokeWidth={2}
        />
        {/* Latest post, highlighted warm */}
        <circle
          className="fill-amber-500 stroke-white"
          cx={306}
          cy={14}
          r={4.5}
          strokeWidth={2}
        />
      </svg>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <MiniChip>
          <span className="font-mono">128k</span> views
        </MiniChip>
        <MiniChip>
          <span className="font-mono">64%</span> completion
        </MiniChip>
      </div>
    </MiniPanel>
  );
}
