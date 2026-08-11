import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Per-use-case band surfaces. The transcribed export has one ground and one
 * accent, so the six audience "rooms" are no longer six pastel washes —
 * each name only decides where the accent enters the surface from. The
 * names are unchanged so the six pages keep their call sites.
 */
const SCENES = {
  pearl: "os-scene os-scene--pearl",
  dusk: "os-scene os-scene--mist",
  mint: "os-scene os-scene--sky",
  tide: "os-scene os-scene--sky",
  steel: "os-scene os-scene--pearl",
  daylight: "os-scene os-scene--mist",
  aurora: "os-scene os-scene--sky",
} as const;

export type SceneName = keyof typeof SCENES;

/** Decorative band surface; content is layered on top by the caller. */
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
