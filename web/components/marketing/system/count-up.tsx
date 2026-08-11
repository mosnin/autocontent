"use client";

import * as React from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

import { EASE } from "./motion";

/**
 * Number that counts up when it scrolls into view. Max 3 per page (spec).
 * Reduced motion renders the final value immediately.
 */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1.6,
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: EASE,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, reduced, value, duration]);

  const shown = reduced ? value : display;

  return (
    <span className={className} ref={ref}>
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}
