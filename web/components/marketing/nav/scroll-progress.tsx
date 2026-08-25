"use client";

import { useMotionValueEvent, useScroll } from "motion/react";
import { useState, type ReactNode } from "react";

export function ScrollProgress(): ReactNode {
  const { scrollYProgress } = useScroll();
  const [percent, setPercent] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    setPercent(Math.round(value * 100));
  });

  return (
    <span
      aria-hidden="true"
      style={{
        backgroundColor: "color-mix(in srgb, currentColor 16%, transparent)",
      }}
      className="min-w-14 shrink-0 rounded-full px-3 py-1.5 text-center text-[13px] font-medium tabular-nums"
    >
      {percent}%
    </span>
  );
}
