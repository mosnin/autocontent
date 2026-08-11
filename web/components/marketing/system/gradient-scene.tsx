import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A band surface. On the light site this was a pastel radial gradient; the
 * transcribed export has one ground colour and earns depth from hairlines,
 * so a "scene" is now the #0F1514 surface with a whisper of the teal accent
 * bleeding in from one corner. The three variant names are kept so call
 * sites don't churn; they only move where the accent enters from.
 */
const VARIANTS = {
  sky: "os-scene os-scene--sky",
  pearl: "os-scene os-scene--pearl",
  mist: "os-scene os-scene--mist",
} as const;

export function GradientScene({
  variant = "sky",
  className,
  children,
  depth: _depth = false,
}: {
  variant?: keyof typeof VARIANTS;
  className?: string;
  children?: React.ReactNode;
  /** Kept for call-site compatibility; the dark ground needs no bloom. */
  depth?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden", VARIANTS[variant], className)}>
      {children}
    </div>
  );
}
