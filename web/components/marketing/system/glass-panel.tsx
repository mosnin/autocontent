import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Frosted glass card: backdrop blur, hairline border, soft floating shadow.
 * The building block for product-UI mockups and overlay cards.
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
      className={cn(
        "rounded-3xl border backdrop-blur-xl",
        tone === "light"
          ? "border-white/50 bg-white/70 shadow-[0_8px_40px_rgba(15,23,42,0.08)]"
          : "border-white/10 bg-zinc-900/70 shadow-[0_8px_40px_rgba(0,0,0,0.35)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
