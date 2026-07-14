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

/**
 * Soft radial gradient scene, used as the backdrop behind glass panels.
 * Purely decorative; content is layered on top by the caller.
 */
export function GradientScene({
  variant = "sky",
  className,
  children,
}: {
  variant?: keyof typeof VARIANTS;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden", VARIANTS[variant], className)}>
      {children}
    </div>
  );
}
