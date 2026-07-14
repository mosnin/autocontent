import * as React from "react";

import { cn } from "@/lib/utils";
import { warmChip } from "@/components/marketing/system/accent";

/**
 * Internal primitives for the vignette library. Vignettes are miniature
 * product UI staged inside a `<VignetteCard>` frame: light mode, hairline
 * borders, frosted white surfaces, 10-13px type. Not exported from the
 * barrel; pages import the finished vignettes.
 */

/** Frosted mini-panel: the root surface of most vignettes. */
export function MiniPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-zinc-900/[0.06] bg-white/85 p-4 shadow-[0_10px_32px_rgba(15,23,42,0.08)] backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Panel header: 13px semibold title, 11px meta, optional right slot. */
export function MiniHeader({
  title,
  meta,
  right,
  className,
}: {
  title: string;
  meta?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-zinc-900">
          {title}
        </p>
        {meta ? (
          <p className="truncate text-[11px] text-zinc-400">{meta}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

/** 11px pill chip. `warm` is the success accent (never green). */
export function MiniChip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warm" | "ink";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium",
        tone === "neutral" && "border border-zinc-900/10 bg-white/80 text-zinc-500",
        tone === "warm" && warmChip,
        tone === "ink" && "border border-zinc-900 bg-zinc-900 text-white",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Small check mark, stroke = currentColor. Product glyph, not decoration. */
export function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("size-3", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
