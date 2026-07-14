import * as React from "react";

import { cn } from "@/lib/utils";
import { CheckGlyph, MiniChip, MiniHeader, MiniPanel } from "./bits";

/** Semicircle dial, $0 left to the hard cap right. Spend sits at 38%. */
const ARC_D = "M 30 104 A 80 80 0 0 1 190 104";

/**
 * The spend guard in miniature: a gauge filling toward the hard-cap
 * tick, today's readout in the middle, warm "Under cap" confirmation.
 */
export function CapGaugeVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[340px]", className)}>
      <MiniHeader meta="espresso · $10/day" title="Spend guard" />
      <svg
        aria-label="Gauge showing $3.80 spent of a $10 daily cap"
        className="mx-auto mt-2 block h-auto w-full max-w-[240px]"
        role="img"
        viewBox="0 0 220 118"
      >
        {/* Track */}
        <path
          className="stroke-zinc-200"
          d={ARC_D}
          fill="none"
          strokeLinecap="round"
          strokeWidth={9}
        />
        {/* Today's spend: 38% of the dial */}
        <path
          className="stroke-zinc-800"
          d={ARC_D}
          fill="none"
          pathLength={1}
          strokeDasharray="0.38 1"
          strokeLinecap="round"
          strokeWidth={9}
        />
        {/* The hard-cap tick, brand recording-orange */}
        <line
          className="stroke-brand"
          strokeLinecap="round"
          strokeWidth={2.5}
          x1={197}
          x2={208}
          y1={104}
          y2={104}
        />
        <text
          className="fill-zinc-300 font-mono text-[9px]"
          textAnchor="middle"
          x={30}
          y={117}
        >
          $0
        </text>
        <text
          className="fill-zinc-300 font-mono text-[9px]"
          textAnchor="middle"
          x={190}
          y={117}
        >
          $10
        </text>
        <text
          className="fill-zinc-900 font-mono text-[21px] font-semibold"
          textAnchor="middle"
          x={110}
          y={90}
        >
          $3.80
        </text>
        <text
          className="fill-zinc-400 text-[10px]"
          textAnchor="middle"
          x={110}
          y={106}
        >
          of $10.00 today
        </text>
      </svg>
      <div className="mt-2.5 flex justify-center">
        <MiniChip tone="warm">
          <CheckGlyph className="size-2.5" />
          Under cap
        </MiniChip>
      </div>
    </MiniPanel>
  );
}
