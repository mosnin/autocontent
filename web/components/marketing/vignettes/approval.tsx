import * as React from "react";

import { cn } from "@/lib/utils";
import { CheckGlyph, MiniChip, MiniHeader, MiniPanel } from "./bits";

/** Tiny video thumb: gradient still + play glyph. */
function Thumb({ wash }: { wash: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-11 w-[4.5rem] shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-zinc-900/[0.06]",
        wash,
      )}
    >
      <svg className="size-3.5 text-white/90 drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5.5v13l11-6.5z" />
      </svg>
    </span>
  );
}

/**
 * Human-in-the-loop review: one clip already approved with the warm
 * check, the next awaiting its Approve / Reject call.
 */
export function ApprovalVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[380px]", className)}>
      <MiniHeader meta="1 awaiting review" title="Review queue" />
      <ul className="mt-3 space-y-2">
        <li className="flex items-center gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
          <Thumb wash="bg-[linear-gradient(135deg,#c7d2fe,#fbcfe8)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-zinc-800">
              3 grinder mistakes ruining your shots
            </p>
            <p className="text-[10.5px] text-zinc-400">0:42 · Shorts</p>
          </div>
          <MiniChip tone="warm">
            <CheckGlyph className="size-2.5" />
            Approved
          </MiniChip>
        </li>
        <li className="flex items-center gap-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
          <Thumb wash="bg-[linear-gradient(135deg,#bae6fd,#c7d2fe)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-zinc-800">
              Dial in espresso in 60 seconds
            </p>
            <p className="text-[10.5px] text-zinc-400">0:38 · TikTok</p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            <MiniChip tone="ink">Approve</MiniChip>
            <MiniChip>Reject</MiniChip>
          </span>
        </li>
      </ul>
    </MiniPanel>
  );
}
