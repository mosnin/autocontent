import * as React from "react";

import { cn } from "@/lib/utils";
import { warmDot } from "@/components/marketing/system/accent";
import { MiniChip, MiniHeader, MiniPanel } from "./bits";

const KEYWORDS = ["best espresso machine", "under $800", "beginner"];
const PASSES = ["title 58/60", "slug", "meta 152ch"];

/**
 * A drafted SEO article: title bar, slug + meta-length chips, target
 * keywords, and the on-page checks passing with warm dots.
 */
export function ArticleSeoVignette({ className }: { className?: string }) {
  return (
    <MiniPanel className={cn("mx-auto max-w-[380px]", className)}>
      <MiniHeader meta="drafted 8:41 AM" title="SEO article" />
      <div className="mt-3 rounded-xl border border-zinc-900/[0.05] bg-white/80 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        <p className="text-[12.5px] font-medium leading-snug text-zinc-800">
          Best home espresso machines in 2026, tested by baristas
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <MiniChip className="font-mono font-normal">
            /best-home-espresso-machines
          </MiniChip>
          <MiniChip className="font-mono font-normal">meta 152ch</MiniChip>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {KEYWORDS.map((kw) => (
          <span
            className="rounded-full bg-zinc-900/[0.05] px-2.5 py-1 text-[10.5px] font-medium text-zinc-500"
            key={kw}
          >
            {kw}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-zinc-900/[0.05] pt-2.5">
        {PASSES.map((label) => (
          <span
            className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-zinc-500"
            key={label}
          >
            <span className={cn("size-1.5 rounded-full", warmDot)} />
            {label}
          </span>
        ))}
      </div>
    </MiniPanel>
  );
}
