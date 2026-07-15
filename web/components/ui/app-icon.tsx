import * as React from "react";

import { cn } from "@/lib/utils";

type Category = "green" | "orange" | "blue" | "purple" | "navy" | "red";
type Size = "sm" | "md";

const TINT: Record<Category, string> = {
  green: "bg-cat-green",
  orange: "bg-cat-orange",
  blue: "bg-cat-blue",
  purple: "bg-cat-purple",
  navy: "bg-cat-navy",
  // Reserved for genuinely critical states (e.g. a dependency down) — reuses
  // the destructive token so red carries a single, consistent meaning.
  red: "bg-destructive",
};

const SIZE: Record<Size, string> = {
  sm: "size-6 rounded-md [&>svg]:size-3.5",
  md: "size-7 rounded-lg [&>svg]:size-4",
};

/**
 * The reference's signature: a small colored rounded-square that carries a
 * white glyph, sitting to the left of every card/panel title. Each surface
 * gets a category color so the dashboard reads as a set of labeled tiles.
 */
export function AppIcon({
  color,
  size = "md",
  className,
  children,
}: {
  color: Category;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-white shadow-sm",
        TINT[color],
        SIZE[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
