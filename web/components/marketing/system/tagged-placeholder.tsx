import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tagged media placeholder for the logged-out site: a duotone scene with
 * a visible PLACEHOLDER chip naming what belongs there (video, image, or
 * graphic illustration). Every future asset drop is a one-element swap.
 * Parent sizes the frame (aspect + rounding + overflow-hidden).
 */

type Kind = "video" | "image" | "illustration";
type Tone = "warm" | "sky" | "violet" | "slate" | "rose";

const TONES: Record<Tone, string> = {
  warm: "linear-gradient(135deg,#fde9d2 0%,#fbd1c2 45%,#f9c1cf 100%)",
  sky: "linear-gradient(135deg,#dbeafe 0%,#c7d9fb 50%,#dcd4fa 100%)",
  violet: "linear-gradient(135deg,#ede9fe 0%,#ddd4fb 50%,#f3d3ef 100%)",
  slate: "linear-gradient(135deg,#eef1f6 0%,#dfe5ee 55%,#e6e2f2 100%)",
  rose: "linear-gradient(135deg,#ffe4e6 0%,#fcd0dd 50%,#f7cbea 100%)",
};

export function TaggedPlaceholder({
  kind,
  label,
  tone = "slate",
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
      className={cn("relative h-full w-full overflow-hidden", className)}
      data-placeholder={kind}
      role="img"
      style={{ background: TONES[tone] }}
    >
      <div
        aria-hidden
        className="absolute -left-[10%] top-[10%] size-[50%] rounded-full bg-white/70 opacity-60 blur-2xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-[16%] -right-[8%] size-[65%] rounded-full bg-white/60 opacity-50 blur-3xl"
      />
      {kind === "video" ? (
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow-[0_8px_28px_rgba(15,23,42,0.15)] backdrop-blur"
        >
          <svg className="ml-0.5 size-5 fill-zinc-800" viewBox="0 0 24 24">
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
        </span>
      ) : null}
      <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border border-white/60 bg-white/80 px-2.5 py-1 backdrop-blur">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Placeholder · {kind}
        </span>
        <span className="text-[10.5px] font-medium text-zinc-700">{label}</span>
      </span>
    </div>
  );
}
