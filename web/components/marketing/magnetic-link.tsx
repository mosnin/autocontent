"use client";

import { motion, useSpring, type MotionStyle } from "motion/react";
import type { PointerEvent, ReactNode } from "react";

export function MagneticLink({
  href,
  reduce,
  className,
  style,
  children,
}: {
  href: string;
  reduce: boolean;
  className?: string;
  style?: MotionStyle;
  children: ReactNode;
}): ReactNode {
  const x = useSpring(0, { stiffness: 220, damping: 17 });
  const y = useSpring(0, { stiffness: 220, damping: 17 });

  const handleMove = (event: PointerEvent<HTMLAnchorElement>): void => {
    if (reduce || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - rect.left - rect.width / 2) * 0.35);
    y.set((event.clientY - rect.top - rect.height / 2) * 0.45);
  };

  const handleLeave = (): void => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.a
      href={href}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      style={{ x, y, ...style }}
      className={className}
    >
      {children}
    </motion.a>
  );
}
