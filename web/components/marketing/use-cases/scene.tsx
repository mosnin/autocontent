import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Per-use-case gradient scenes. Same family as the system
 * `<GradientScene>` (soft, low-saturation radials on a cool canvas) but
 * each audience page gets its own tint so the section feels like six
 * rooms in one house.
 */
const SCENES = {
  /** Hub: barely-there pearl, the quiet lobby. */
  pearl:
    "bg-[radial-gradient(110%_110%_at_50%_-10%,#f0f4ff_0%,#fafafa_60%,#f5f6f8_100%)]",
  /** Creators: indigo dusk, the evening posting window. */
  dusk: "bg-[radial-gradient(120%_120%_at_80%_-10%,#e0e7ff_0%,#f5f3ff_48%,#fafafa_100%)]",
  /** Ecommerce: soft mint, shelf-fresh. */
  mint: "bg-[radial-gradient(120%_120%_at_15%_-10%,#d9f2e9_0%,#effaf5_50%,#f8fafc_100%)]",
  /** SaaS: sky-to-cyan tide. */
  tide: "bg-[radial-gradient(120%_120%_at_85%_-10%,#dbeafe_0%,#e0f2fe_45%,#f8fafc_100%)]",
  /** Agencies: cool steel, the ops floor. */
  steel:
    "bg-[radial-gradient(120%_120%_at_50%_-15%,#e2e8f0_0%,#eef2ff_50%,#fafafa_100%)]",
  /** Local business: warm shopfront daylight. */
  daylight:
    "bg-[radial-gradient(120%_120%_at_20%_-10%,#faf0dc_0%,#fdfaf1_50%,#f8fafc_100%)]",
  /** AI agents: violet aurora, the flagship. */
  aurora:
    "bg-[radial-gradient(120%_130%_at_70%_-15%,#e0e7ff_0%,#ede9fe_45%,#fdf2f8_100%)]",
} as const;

export type SceneName = keyof typeof SCENES;

/** Decorative gradient backdrop; content is layered on top by the caller. */
export function UseCaseScene({
  name,
  className,
  children,
}: {
  name: SceneName;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden", SCENES[name], className)}>
      {children}
    </div>
  );
}
