import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Quiet bordered panel. Light tone sits on the Cortex canvas; dark tone
 * uses the inverted --surface token so it matches homepage final-cta.
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
        "rounded-3xl border",
        tone === "light" && "border-border bg-background",
        className,
      )}
      style={
        tone === "dark"
          ? {
              backgroundColor: "var(--surface)",
              color: "var(--surface-foreground)",
              borderColor: "transparent",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
