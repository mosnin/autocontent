"use client";

import * as React from "react";
import { useReducedMotion, useScroll, type MotionValue } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Apple-style pinned scene: a tall scroll track with a sticky, screen-height
 * stage. `children` is a render prop that receives scroll progress (0-1)
 * through the track. Max ONE per page (spec).
 *
 * Reduced motion: the pinned scene is skipped entirely and `fallback`
 * renders as a normal static section.
 */
export function PinnedScene({
  children,
  fallback,
  className,
  trackClassName = "h-[300vh]",
}: {
  children: (progress: MotionValue<number>) => React.ReactNode;
  /** Static replacement rendered under prefers-reduced-motion. */
  fallback: React.ReactNode;
  className?: string;
  /** Height of the scroll track; controls how long the scene is pinned. */
  trackClassName?: string;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  if (reduced) {
    return <div className={className}>{fallback}</div>;
  }

  return (
    <div className={cn("relative", trackClassName, className)} ref={ref}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="w-full">{children(scrollYProgress)}</div>
      </div>
    </div>
  );
}
