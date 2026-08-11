import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A surface panel: the #0F1514 card ground with a rgb(42,60,58) hairline.
 *
 * The name is historical — on the light site this was frosted glass. On the
 * transcribed dark ground there is no glass; depth comes from the surface
 * being a shade below the page and from the hairline, exactly as the
 * homepage's cards do it. `tone` is kept for call-site compatibility and
 * only chooses how far the surface sits from the ground.
 */
export function GlassPanel({
  children,
  className,
  tone = "light",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "light" | "dark";
}) {
  return (
    <div
      className={cn("os-card", tone === "dark" && "os-card--raised", className)}
    >
      {children}
    </div>
  );
}
