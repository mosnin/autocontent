import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Quiet panel behind marketing sections. The Cortex template is a flat
 * white/black canvas - no colored gradient washes.
 */
export function GradientScene({
  variant: _variant = "sky",
  className,
  children,
  depth: _depth = false,
}: {
  variant?: "sky" | "pearl" | "mist";
  className?: string;
  children?: React.ReactNode;
  depth?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {children}
    </div>
  );
}
