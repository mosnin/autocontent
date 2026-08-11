import * as React from "react";

import { cn } from "@/lib/utils";

const VARIANTS = {
  /** Soft daylight blue, the hero scene. */
  sky: "bg-[radial-gradient(120%_120%_at_85%_-10%,#dbeafe_0%,#eff6ff_52%,#f8fafc_100%)]",
  /** Barely-there warm pearl, for quiet sections. */
  pearl:
    "bg-[radial-gradient(110%_110%_at_50%_-10%,#f0f4ff_0%,#fafafa_60%,#f5f6f8_100%)]",
  /** Low-saturation lavender to blush, for closing bands. */
  mist: "bg-[radial-gradient(120%_130%_at_20%_-10%,#e0e7ff_0%,#eef2ff_45%,#fdf2f8_100%)]",
} as const;

/** Per-variant bloom tints for the optional depth pass. */
const BLOOMS: Record<
  keyof typeof VARIANTS,
  { a: string; b: string }
> = {
  sky: { a: "bg-sky-200/40", b: "bg-indigo-200/30" },
  pearl: { a: "bg-indigo-100/40", b: "bg-rose-100/30" },
  mist: { a: "bg-violet-200/40", b: "bg-rose-200/35" },
};

/** Tiny SVG noise, tiled at very low opacity. Never noisy. */
const GRAIN =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;

/**
 * Soft radial gradient scene, used as the backdrop behind glass panels.
 * Purely decorative; content is layered on top by the caller.
 *
 * `depth` (opt-in) adds photographic depth: two blurred bloom washes and
 * a whisper of grain beneath the content. Default output is unchanged.
 */
export function GradientScene({
  variant = "sky",
  className,
  children,
  depth = false,
}: {
  variant?: keyof typeof VARIANTS;
  className?: string;
  children?: React.ReactNode;
  depth?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden", VARIANTS[variant], className)}>
      {depth ? (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className={cn(
              "absolute -top-[20%] right-[-12%] h-[65%] w-[55%] rounded-full blur-3xl",
              BLOOMS[variant].a,
            )}
          />
          <div
            className={cn(
              "absolute bottom-[-28%] left-[-12%] h-[60%] w-[50%] rounded-full blur-3xl",
              BLOOMS[variant].b,
            )}
          />
          <div
            className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
            style={{ backgroundImage: GRAIN }}
          />
        </div>
      ) : null}
      {depth ? <div className="relative">{children}</div> : children}
    </div>
  );
}
