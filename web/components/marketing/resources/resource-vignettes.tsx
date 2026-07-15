import * as React from "react";

import { warmChip, warmDot } from "@/components/marketing/system";
import { cn } from "@/lib/utils";

/**
 * Local mini-vignettes for the resources hub (Amendment 2): the same
 * miniature product-UI language as components/marketing/vignettes —
 * frosted white panels, hairlines, 10-13px type, warm accent, never
 * green. Staged inside `<VignetteCard>` frames by the hub page.
 */

const PANEL =
  "w-full rounded-2xl border border-zinc-900/[0.06] bg-white/85 p-4 shadow-[0_10px_32px_rgba(15,23,42,0.08)] backdrop-blur-sm";

const RELEASES = [
  { date: "Jun 26", title: "MCP server v1", latest: true },
  { date: "Jun 12", title: "Per-niche daily caps", latest: false },
  { date: "May 30", title: "Article QA pass", latest: false },
];

/**
 * The changelog in miniature: a hairline rail, three dated releases,
 * the newest carrying the warm node and a "New" chip.
 */
export function ChangelogMiniVignette({ className }: { className?: string }) {
  return (
    <div className={cn(PANEL, "mx-auto max-w-[340px]", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-zinc-900">Changelog</p>
        <p className="text-[11px] text-zinc-400">newest first</p>
      </div>
      <div className="relative mt-3">
        <span
          aria-hidden
          className="absolute inset-y-2 left-[3px] w-px bg-zinc-900/[0.08]"
        />
        <ul className="space-y-2.5">
          {RELEASES.map((release) => (
            <li
              className="relative flex items-center gap-3 pl-5"
              key={release.title}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1/2 size-[7px] -translate-y-1/2 rounded-full",
                  release.latest
                    ? warmDot
                    : "border border-zinc-300 bg-white",
                )}
              />
              <span className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                {release.date}
              </span>
              <span className="truncate text-[11.5px] font-medium text-zinc-700">
                {release.title}
              </span>
              {release.latest ? (
                <span
                  className={cn(
                    "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    warmChip,
                  )}
                >
                  New
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const CLOSED_QUESTIONS = ["Do credits expire?", "Who owns the output?"];

/**
 * The FAQ in miniature: one accordion row open with its plain answer,
 * two collapsed rows waiting below.
 */
export function FaqMiniVignette({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[340px] space-y-1.5", className)}>
      <div className="rounded-xl border border-zinc-900/15 bg-white/90 px-3.5 py-2.5 shadow-[0_6px_20px_rgba(15,23,42,0.07)]">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[12px] font-semibold text-zinc-900">
            Can it overspend my cap?
          </p>
          <span
            aria-hidden
            className="flex size-5 shrink-0 rotate-45 items-center justify-center rounded-full border border-zinc-900/10 text-[11px] leading-none text-zinc-500"
          >
            +
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          No. Work that would cross a cap is refused before it runs, not
          billed.
        </p>
      </div>
      {CLOSED_QUESTIONS.map((q) => (
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900/[0.06] bg-white/85 px-3.5 py-2.5"
          key={q}
        >
          <p className="truncate text-[12px] font-medium text-zinc-700">{q}</p>
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-zinc-900/10 text-[11px] leading-none text-zinc-400"
          >
            +
          </span>
        </div>
      ))}
    </div>
  );
}
