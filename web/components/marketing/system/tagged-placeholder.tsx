import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tagged media placeholder: a plain flat surface with one small text tag
 * naming what belongs there (video, image, or illustration). No shapes,
 * no gradients, no fake art — it reads as "media goes here" and nothing
 * else. Parent sizes the frame (aspect + rounding + overflow-hidden).
 * Swapping in the real asset is a one-element change.
 */

type Kind = "video" | "image" | "illustration";
/** Kept for call-site compatibility; tone no longer changes the render. */
type Tone = "warm" | "sky" | "violet" | "slate" | "rose";

export function TaggedPlaceholder({
  kind,
  label,
  tone: _tone = "slate",
  className,
}: {
  kind: Kind;
  /** What belongs here, e.g. "Feature demo — script to render". */
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      aria-label={`Placeholder ${kind}: ${label}`}
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-zinc-100",
        className,
      )}
      data-placeholder={kind}
      role="img"
    >
      <span className="max-w-[90%] truncate rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[10px] text-zinc-400">
        {kind}: {label}
      </span>
    </div>
  );
}
