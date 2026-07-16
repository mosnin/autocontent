"use client";

import * as React from "react";
import {
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  type HTMLMotionProps,
} from "motion/react";

import { cn } from "@/lib/utils";

// Brand warm sweep. Three stops (orange, pink, orange) so the moving
// background-position loops seamlessly. Matches --gradient-warm.
const BRAND_COLORS = [
  "hsl(20 90% 45%)",
  "hsl(345 80% 50%)",
  "hsl(20 90% 45%)",
];
// Solid fallback where background-clip:text is unsupported — the darker
// orange holds AA large-text contrast on the light canvas, same as
// the .text-gradient utility.
const FALLBACK_COLOR = "hsl(20 90% 42%)";

export interface GradientTextProps
  extends Omit<HTMLMotionProps<"span">, "color"> {
  /** Gradient stops, left to right. Defaults to the brand warm sweep. */
  colors?: string[];
  /** Seconds for one full sweep. */
  speed?: number;
  /** Sweep direction. */
  direction?: "left" | "right";
  /** Bounce back and forth instead of looping in one direction. */
  yoyo?: boolean;
  /** Freeze the animation while hovered. */
  pauseOnHover?: boolean;
}

/**
 * Animated gradient text. The gradient is clipped to the glyphs and its
 * background-position sweeps over time, so titles feel quietly alive without
 * pulling focus. Honors prefers-reduced-motion by holding a static gradient.
 *
 * Render it as the inline accent inside a heading, the same way the static
 * `.text-gradient` utility is used:
 *   <h1>Marketing that <GradientText>runs itself</GradientText></h1>
 */
export function GradientText({
  children,
  className,
  colors = BRAND_COLORS,
  speed = 8,
  direction = "right",
  yoyo = false,
  pauseOnHover = false,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: GradientTextProps) {
  const reduced = useReducedMotion();
  const hovered = React.useRef(false);
  const posX = useMotionValue(reduced ? 50 : 0);
  const backgroundPosition = useMotionTemplate`${posX}% 50%`;

  useAnimationFrame((t) => {
    if (reduced) return;
    if (pauseOnHover && hovered.current) return;
    const period = Math.max(0.5, speed) * 1000;
    const phase = (t % period) / period; // 0..1
    let p = yoyo
      ? (phase < 0.5 ? phase * 2 : 2 - phase * 2) * 100 // 0..100..0
      : phase * 100;
    if (direction === "left") p = 100 - p;
    posX.set(p);
  });

  const gradient = `linear-gradient(90deg, ${colors.join(", ")})`;

  return (
    <motion.span
      className={cn("bg-clip-text text-transparent", className)}
      style={{
        color: FALLBACK_COLOR,
        backgroundImage: gradient,
        backgroundSize: "200% 100%",
        backgroundPosition,
        WebkitTextFillColor: "transparent",
        ...style,
      }}
      onMouseEnter={(e) => {
        hovered.current = true;
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        hovered.current = false;
        onMouseLeave?.(e);
      }}
      {...rest}
    >
      {children}
    </motion.span>
  );
}
